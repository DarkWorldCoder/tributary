'use strict';
// Input JSON and sampled working-set comparison, not total Electron/GPU RAM.
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process'); const { DatabaseSync } = require('node:sqlite'); const v8 = require('node:v8');
const { ExtensionCache, summary } = require('../../core/extension-cache');
const tick = () => new Promise(setImmediate); const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pss = () => { try { return Number(/^Pss:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/self/smaps_rollup', 'utf8'))[1]); } catch { return null; } };
async function collect() { global.gc(); await tick(); global.gc(); await tick(); }
function fixture(index) {
  const id = `fixture.pack-${index}`;
  const image = (variant) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><desc>${index}/${variant}:` + 'fixture '.repeat(90000) + '</desc><path fill="#55aa88" d="M0 0h16v16H0z"/></svg>').toString('base64');
  return { id, name: `Fixture ${index}`, publisher: 'fixture', version: '1.0.0', hasRuntime: false,
    themes: [0, 1].map((variant) => ({ id: `${id}:theme:${variant}`, label: `Theme ${variant}`, dark: variant === 0, colors: { 'editor.background': '#112233' }, tokenColors: [{ scope: 'keyword', foreground: '#ff7766' }] })),
    iconThemes: [0, 1].map((variant) => ({ id: `${id}:icons:${variant}`, label: `Icons ${variant}`, definitions: { source: { image: image(variant) } }, fonts: [], associations: { fileExtensions: { js: 'source', ts: 'source' } }, light: {}, highContrast: {} })) };
}
class WholePackReference {
  constructor(dir) { this.dir = dir; }
  async read(id) { const file = path.join(this.dir, id + '.json'); if ((await fs.promises.stat(file)).size > 100 * 1024 * 1024) throw new Error('Invalid extension cache.'); return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
  async list() { const names = await fs.promises.readdir(this.dir).catch(() => []); return (await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => this.read(name.slice(0,-5)).then(summary).catch(() => null)))).filter(Boolean); }
  async appearance(themeId, iconsId) { const load = async (id, kind) => id ? (await this.read(id.split(':')[0]))[kind].find((item) => item.id === id) || null : null; return { theme: await load(themeId,'themes'), icons: await load(iconsId,'iconThemes') }; }
}
async function worker(seed, mode, operation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-appearance-worker-')); fs.cpSync(seed, root, { recursive: true });
  const stats = { legacyReadBytes: 0, sqlReturnedTextBytes: 0, readFileCalls: 0, maxConcurrentLegacyReads: 0 }; let active = 0; let peak; let baseline;
  const observe = () => { const value = process.memoryUsage(); if (!peak) peak = { ...value }; else for (const key of Object.keys(value)) peak[key] = Math.max(peak[key], value[key]); };
  const rawRead = fs.promises.readFile;
  fs.promises.readFile = async (...args) => { active++; stats.readFileCalls++; stats.maxConcurrentLegacyReads = Math.max(stats.maxConcurrentLegacyReads, active); try { const value = await rawRead(...args); stats.legacyReadBytes += typeof value === 'string' ? Buffer.byteLength(value) : value.length; observe(); return value; } finally { active--; } };
  const observeRow = (row) => { for (const key of ['summary','data']) if (typeof row?.[key] === 'string') stats.sqlReturnedTextBytes += Buffer.byteLength(row[key]); observe(); return row; };
  function MeteredDatabase(file) {
    const db = new DatabaseSync(file);
    return new Proxy(db, { get(target, property) {
      if (property === 'prepare') return (sql) => { const statement = target.prepare(sql); return new Proxy(statement, { get(target, method) {
        if (method === 'get') return (...args) => observeRow(target.get(...args));
        if (method === 'iterate') return function* (...args) { for (const row of target.iterate(...args)) yield observeRow(row); };
        const value = Reflect.get(target, method, target); return typeof value === 'function' ? value.bind(target) : value;
      } }); };
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  const cache = mode === 'whole-pack' ? new WholePackReference(root) : new ExtensionCache(root, { database: MeteredDatabase });
  const selected = fixture(0); const expected = operation === 'list' ? Array.from({ length:32 }, (_,i)=>summary(fixture(i))).sort((a,b)=>a.id.localeCompare(b.id)) : { theme: selected.themes[0], icons: operation === 'combined' ? selected.iconThemes[0] : null };
  const expectedHash = hash(expected); // Fixture construction is outside all measured boundaries.
  try {
    await collect(); baseline = process.memoryUsage(); peak = { ...baseline }; const baselinePss = pss(); const timings = []; let timer = setInterval(observe, 1);
    try { for (let i=0;i<3;i++) {
      const started = performance.now(); const value = operation === 'list' ? await cache.list() : await cache.appearance(selected.themes[0].id, operation === 'combined' ? selected.iconThemes[0].id : '');
      timings.push(performance.now()-started); observe();
      if (hash(operation === 'list' ? value.sort((a,b)=>a.id.localeCompare(b.id)) : value) !== expectedHash) throw new Error('Appearance payload parity failed');
      observe(); await tick();
    } } finally { clearInterval(timer); }
    const natural = { ...process.memoryUsage(), pssKiB: pss() }; await collect(); const retained = { ...process.memoryUsage(), pssKiB: pss(), physicalHeapBytes:v8.getHeapStatistics().total_physical_size };
    return { mode, operation, requests:3, stats, baseline, baselinePssKiB:baselinePss, peakSampled:peak, peakSampledHeapDeltaBytes:peak.heapUsed-baseline.heapUsed, natural, retainedAfterDiagnosticGc:retained, elapsedMs:timings, exactPayloadParity:true,
      jsonInputBytes:stats.legacyReadBytes+stats.sqlReturnedTextBytes, notes:['SQL counters include returned JSON text, not SQLite file/page IO','Sampled peak includes verification serialization and can miss synchronous native allocation peaks','Diagnostic GC only at initial/final boundaries; no app GC changes'] };
  } finally { fs.promises.readFile=rawRead; fs.rmSync(root,{recursive:true,force:true}); }
}
async function main() {
  if (process.argv[2] === '--worker') { process.stdout.write(JSON.stringify(await worker(process.argv[3],process.argv[4],process.argv[5]))); return; }
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-appearance-bench-')); const legacy=path.join(root,'legacy');const indexed=path.join(root,'indexed');fs.mkdirSync(legacy);const cache=new ExtensionCache(indexed);let fixtureBytes=0;
  try {
    for(let i=0;i<32;i++){const pack=fixture(i);const text=JSON.stringify(pack);fixtureBytes+=Buffer.byteLength(text);fs.writeFileSync(path.join(legacy,pack.id+'.json'),text);cache.persist(pack);}
    const cases=[];
    for(let round=0;round<3;round++) for(const operation of ['list','theme','combined']) for(const mode of round%2?['indexed','whole-pack']:['whole-pack','indexed']){
      const child=spawnSync(process.execPath,['--expose-gc','--no-warnings',__filename,'--worker',mode==='whole-pack'?legacy:indexed,mode,operation],{encoding:'utf8',timeout:120000});if(child.status!==0)throw new Error(child.stderr||'Appearance benchmark failed');cases.push({round,...JSON.parse(child.stdout)});
    }
    const migration=spawnSync(process.execPath,['--expose-gc','--no-warnings',__filename,'--worker',legacy,'migration','list'],{encoding:'utf8',timeout:120000});if(migration.status!==0)throw new Error(migration.stderr||'Migration benchmark failed');cases.push({round:0,...JSON.parse(migration.stdout)});
    const files=['core/extension-cache.js','core/extension-packs.js','scripts/performance/appearance-cache.cjs'];const report={date:new Date().toISOString(),runtime:{node:process.version,platform:process.platform,arch:process.arch},fixture:{packs:32,iconVariantsPerPack:2,fullJsonBytes:fixtureBytes,requestsPerProcess:3},boundaries:['Deterministic valid synthetic SVG assets; no downloads or inference','Original whole-file list/appearance algorithm is preserved as WholePackReference','Three alternating process pairs per operation; one cold migration process','Not an Electron, GPU, visible-icon rendering or total-app RAM benchmark'],sourceHashes:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../..',f))).digest('hex')])),cases};
    const i=process.argv.indexOf('--output');if(i!==-1)fs.writeFileSync(process.argv[i+1],JSON.stringify(report,null,2)+'\n');
    for(const op of ['list','theme','combined'])for(const mode of ['whole-pack','indexed']){const rows=cases.filter(x=>x.operation===op&&x.mode===mode);const median=k=>rows.map(x=>x[k]).sort((a,b)=>a-b)[1];console.log(JSON.stringify({operation:op,mode,runs:rows.length,medianJsonInputBytes:median('jsonInputBytes'),medianSampledHeapDeltaBytes:median('peakSampledHeapDeltaBytes'),requestMs:rows.map(r=>r.elapsedMs)}));}
    console.log(JSON.stringify({migration:cases.at(-1).elapsedMs,concurrentLegacyReads:cases.at(-1).stats.maxConcurrentLegacyReads}));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1});
