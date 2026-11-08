'use strict';
// Freeze the existing controller with a single ordinary twenty-cycle pair.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto'), zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), output = path.resolve(process.argv[3]);
assert.equal(process.argv.length, 4, 'Pass a frozen baseline and a new report path.');
assert.ok(!fs.existsSync(output), 'Choose a new report path.');
let code = fs.readFileSync(path.join(__dirname, 'attachment-images.cjs'), 'utf8');
const changes = [
  ["path.resolve(__dirname,'../..')", JSON.stringify(repo)],
  ["[{count:1,diagnostic:false},{count:16,diagnostic:false},{count:16,diagnostic:true},{count:1,diagnostic:false,textOnly:true}]", "[{count:16,diagnostic:false}]"],
  ['repeat<(verify?1:3)', 'repeat<(verify?1:1)'],
  ['cycles:3', 'cycles:20'],
  ['timeout:260000', 'timeout:920000'],
  ['verify?3:24', 'verify?3:2'],
];
for (const [before, after] of changes) { assert.equal(code.split(before).length, 2, 'Unique controller change: ' + before); code = code.replace(before, after); }
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-attachment-long-'));
try {
  const generated = path.join(scratch, 'attachment-images.cjs'); fs.writeFileSync(generated, code);
  fs.writeFileSync(output + '.driver.cjs.gz', zlib.gzipSync(code, { level: 9 }));
  const nativeOriginal = fs.readFileSync(path.join(__dirname, 'native-attachment-images.cjs'), 'utf8');
  assert.equal(nativeOriginal.split('240000').length, 2, 'Unique native deadline');
  const nativeCode = nativeOriginal.replace('240000', '900000');
  fs.writeFileSync(path.join(scratch, 'native-attachment-images.cjs'), nativeCode);
  fs.writeFileSync(output + '.native.cjs.gz', zlib.gzipSync(nativeCode, { level: 9 }));
  fs.symlinkSync(path.join(__dirname, 'app-memory.cjs'), path.join(scratch, 'app-memory.cjs'));
  execFileSync(process.execPath, [generated, path.resolve(process.argv[2]), output], { cwd: repo, stdio: 'inherit', timeout: 1900000 });
  const report = JSON.parse(fs.readFileSync(output)); assert.equal(report.complete, true); assert.equal(report.runs.length, 1);
  report.longController = { wrapperSha256: hash(fs.readFileSync(__filename)), generatedSha256: hash(code), changes, nativeOriginalSha256: hash(nativeOriginal), nativeGeneratedSha256: hash(nativeCode), nativeChanges: [['240000', '900000']] };
  report.scope = 'One fresh baseline/candidate pair, sixteen image sources, ordinary collection, twenty additional forward/reverse cycles after the initial walk, then clear/settle. The unchanged native helper, production/build and image fingerprints are recorded. No forced collection, pixel/hash/full-image-dialog work, concurrent tests/builds or native benchmarks. Checkpoints miss short peaks and do not establish a universal plateau, input-to-paint, cross-editor or model-memory result.';
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
