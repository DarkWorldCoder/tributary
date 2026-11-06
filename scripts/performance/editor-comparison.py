"""External X11 large-project navigation probe. No editor debugger or forced GC.
Requires Linux, Xvfb, libX11/libXtst, Node and installed VS Code/Zed. Pillow is
required for failure/success screenshots. Run serially with other work stopped.
"""
import argparse, hashlib, importlib.util, json, os, platform, signal, statistics, subprocess, tempfile, time
from pathlib import Path
spec = importlib.util.spec_from_file_location('x11_input', Path(__file__).with_name('x11-input.py'))
x11 = importlib.util.module_from_spec(spec); spec.loader.exec_module(x11)
parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True); parser.add_argument('--runs', type=int, default=3); parser.add_argument('--files', type=int, default=20000); parser.add_argument('--apps', default='tributary,code,zed'); args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]; root = Path(tempfile.mkdtemp(prefix='tributary-editor-comparison-')); project = root/'project'; project.mkdir()
report = {'complete':False,'date':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'runs':[],'rejected':[],'temporaryDirectory':str(root),'method': 'External X11 keystrokes, same 1280x900 display and generated project committed into a clean Git working tree. Isolated app data/config/cache/home and unavailable session bus; no installed third-party extensions or AI generation. VS Code AI features and its TypeScript language-feature extension are disabled; Zed external language servers are disabled; Tributary agent discovery is disabled. Built-in language work and rendering backends differ. Warm OS page cache, 20 seconds settling after initial buffer verification. Picker visibility is observed through a changed top-center display region, then its exact query is confirmed through clipboard and its image is settled in 120ms polling intervals. Timings include these verification/settling costs; they are deliberately coarse workflow observations. Completion is checked by copying the actual source buffer/selected line through X11 clipboard, polling at 50ms with additional asynchronous clipboard overhead. These are coarse end-to-end navigation workflow observations, not frame/paint, exact input latency, cold startup, production p95 or semantic LSP throughput. Xvfb software graphics: Zed uses emulated Vulkan and warns of poor performance; this is not a hardware-GPU ranking. No debugger, profiler or forced GC. Failed small pilots are excluded; every final cohort case must pass. Large-file completion requires exact first and final nonempty source lines after native EOF navigation. Repeated same-buffer verification controls are recorded without subtracting them. App-tree PSS is sampled separately after work; reparented/external helpers, display-server allocations and GPU VRAM are outside its boundary.'}
def write_report(): Path(args.output).write_text(json.dumps(report,indent=2)+'\n')
def command_version(command):
    result = subprocess.run(command,text=True,capture_output=True,timeout=15); return result.stdout.strip()
report['versions'] = {'code':command_version(['code','--version']), 'zed':command_version(['zed','--version']), 'tributarySource':command_version(['git','-C',str(repo),'rev-parse','HEAD']), 'node':command_version(['node','--version'])}
report['hardware'] = {'platform':platform.platform(),'machine':platform.machine(),'cpu':next((line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')),'unknown'),'logicalCpus':os.cpu_count(),'totalMemoryKiB':int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:')))}
def fingerprint():
    names=subprocess.check_output(['git','-C',str(repo),'ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
    files=[repo/name for name in sorted(set(names)) if name and (name.startswith(('core/','desktop/','ui/src/')) or name in ['package.json','package-lock.json','ui/package.json','ui/package-lock.json','ui/vite.config.ts','scripts/performance/editor-comparison.py','scripts/performance/x11-input.py','scripts/performance/native-comparison.cjs']) and (repo/name).is_file()]
    return {str(file.relative_to(repo)):hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
def build_hash():
    digest=hashlib.sha256()
    for file in sorted((repo/'ui/dist').rglob('*')):
        if file.is_file():digest.update(str(file.relative_to(repo/'ui/dist')).encode()+b'\0'+hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()
report['sources']=fingerprint();report['uiBuildSha256']=build_hash()

manifest = hashlib.sha256(); fixture_bytes = 0
for i in range(args.files):
    rel = f'src/module{i//200:03d}/file{i:05d}.ts'; file = project/rel; file.parent.mkdir(parents=True,exist_ok=True)
    data = ''.join(f'export const item{j:03d} = {i+j};\n' for j in range(100)).encode(); file.write_bytes(data); manifest.update(rel.encode()+b'\0'+data); fixture_bytes+=len(data)
targets = {}
for i in range(7):
    rel=f'bench{i:04d}.ts'; data=''.join(f'export const target{i}row{j} = {j};\n' for j in range(300)); (project/rel).write_text(data); targets[rel]=data; manifest.update(rel.encode()+b'\0'+data.encode()); fixture_bytes+=len(data.encode())
large = ['// benchmark large document\n']+[f'// row {i:05d} value\n' for i in range(40000)]
for i in range(6): large[5000+i*5000]=f'// needle{i:04d}\n'
large_text=''.join(large);(project/'large.ts').write_text(large_text);manifest.update(b'large.ts\0'+large_text.encode());fixture_bytes+=len(large_text.encode())
report['fixture']={'indexedSourceFiles':args.files+8,'backgroundSourceLines':args.files*100,'largeDocumentNonemptyLines':len(large),'bytes':fixture_bytes,'sha256':manifest.hexdigest()}
subprocess.run(['git','init','-q',str(project)],check=True)
subprocess.run(['git','-C',str(project),'add','.'],check=True)
subprocess.run(['git','-C',str(project),'-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Benchmark fixture','-c','user.email=benchmark@localhost','commit','-qm','Generated navigation fixture'],check=True)
report['fixture']['gitCommit']=command_version(['git','-C',str(project),'rev-parse','HEAD'])
report['fixture']['gitState']='clean tracked working tree'
def fixture_hash():
    digest=hashlib.sha256()
    names=(f'src/module{i//200:03d}/file{i:05d}.ts' for i in range(args.files))
    for rel in [*names,*targets,'large.ts']:
        digest.update(rel.encode()+b'\0')
        with (project/rel).open('rb') as source:
            for block in iter(lambda:source.read(65536),b''):digest.update(block)
    return digest.hexdigest()
p = x11.Probe(); resize=x11.api(x11.x,'XMoveResizeWindow',[x11.P,x11.W,x11.I,x11.I,x11.U,x11.U])
def copy_all(editor=False):
    if editor:x11.click(p);time.sleep(.03)
    p.key('a',('Control_L',));p.key('c',('Control_L',));time.sleep(.025);return p.clipboard()
def until_buffer(expected,timeout=30):
    end=time.monotonic()+timeout
    value=None
    while time.monotonic()<end:
        value=copy_all(editor=True)
        if value==expected: p.key('Right');return
        time.sleep(.05)
    raise RuntimeError(f'Buffer verification timed out: length={len(value) if value else None}, prefix={value[:80] if value else None!r}')
def settle():
    before=x11.pixels(p);end=time.monotonic()+5
    while time.monotonic()<end:
        time.sleep(.12);after=x11.pixels(p)
        if x11.delta(before,after)<15:return
        before=after
    raise RuntimeError('Display region did not settle')
def picker(key):
    before=x11.pixels(p);p.key(key,('Control_L',));end=time.monotonic()+15
    while time.monotonic()<end:
        time.sleep(.025)
        if x11.delta(before,x11.pixels(p))>150:settle();return
    raise RuntimeError('Picker did not become visible')
def query_text(text):
    p.key('a',('Control_L',));p.type(text);end=time.monotonic()+15
    while time.monotonic()<end:
        if copy_all()==text:p.key('Right');settle();return
        time.sleep(.05)
    raise RuntimeError('Picker query was not acknowledged')
def open_file(filename,expected):
    settle();start=time.perf_counter();picker('p');query_text(filename);p.key('Return');until_buffer(expected,15)
    return (time.perf_counter()-start)*1000

try:
    for repeat in range(args.runs):
        apps=args.apps.split(','); order=apps[repeat%len(apps):]+apps[:repeat%len(apps)]
        for appname in order:
            profile=root/f'{repeat}-{appname}';profile.mkdir();env=os.environ.copy();env.pop('WAYLAND_DISPLAY',None);env.update({'XDG_CONFIG_HOME':str(profile/'config'),'XDG_DATA_HOME':str(profile/'data'),'XDG_CACHE_HOME':str(profile/'cache'),'LIBGL_ALWAYS_SOFTWARE':'1','XDG_SESSION_TYPE':'x11','HOME':str(profile/'home'),'DBUS_SESSION_BUS_ADDRESS':'unix:path=/tmp/tributary-no-session-bus'})
            (profile/'home').mkdir();configuration={'agentDiscovery':False,'layout':'editor','expanded':True,'theme':'dark'}
            if appname=='tributary':
                env.update({'TRIBUTARY_COMPARE_PROJECT':str(project),'TRIBUTARY_COMPARE_PROFILE':str(profile/'app')});cmd=[str(repo/'node_modules/.bin/electron'),str(repo/'scripts/performance/native-comparison.cjs'),'--ozone-platform=x11']
            elif appname=='code':
                settings=profile/'app/User/settings.json';settings.parent.mkdir(parents=True);settings.write_text(json.dumps({'security.workspace.trust.enabled':False,'telemetry.telemetryLevel':'off','update.mode':'none','workbench.startupEditor':'none','extensions.autoUpdate':False,'editor.formatOnSave':False,'window.titleBarStyle':'custom','editor.minimap.enabled':False,'chat.disableAIFeatures':True,'workbench.colorTheme':'Default Dark Modern'}))
                cmd=['/usr/share/code/code','--user-data-dir',str(profile/'app'),'--extensions-dir',str(profile/'extensions'),'--disable-extensions','--disable-extension','vscode.typescript-language-features','--skip-welcome','--disable-workspace-trust','--new-window','--ozone-platform=x11',str(project),str(project/'bench0000.ts')]
            elif appname=='zed':
                env['ZED_ALLOW_EMULATED_GPU']='1'
                settings=profile/'app/config/settings.json';settings.parent.mkdir(parents=True);settings.write_text(json.dumps({'theme':'One Dark','enable_language_server':False,'session':{'trust_all_worktrees':True},'telemetry':{'diagnostics':False,'metrics':False},'auto_update':False,'auto_install_extensions':{'html':False},'format_on_save':'off','edit_predictions':{'provider':'none'}}))
                cmd=[str(Path.home()/'.local/zed.app/libexec/zed-editor'),'--user-data-dir',str(profile/'app'),str(project),str(project/'bench0000.ts')]
            else: raise ValueError(appname)
            assert fixture_hash()==manifest.hexdigest(), 'Fixture changed'
            assert fingerprint()==report['sources'] and build_hash()==report['uiBuildSha256'], 'Source/build changed'
            if appname!='tributary':configuration=json.loads(settings.read_text())
            print('Starting',appname,repeat,flush=True);log=(profile/'app.log').open('w');child=subprocess.Popen(cmd,env=env,stdout=log,stderr=log,start_new_session=True)
            row={'app':appname,'repeat':repeat,'pid':child.pid,'loadAverage':os.getloadavg(),'configuration':configuration,'quickOpenMs':[],'largeFileOpenMs':[],'passed':False};report['runs'].append(row);write_report()
            try:
                time.sleep(3)
                end=time.monotonic()+45;windows=[]
                while time.monotonic()<end:
                    windows=p.windows()
                    if windows: break
                    if child.poll() is not None: raise RuntimeError(f'App exited {child.returncode}; inspect {profile}/app.log')
                    time.sleep(.1)
                if not windows: raise RuntimeError('No app window')
                win=max(windows,key=lambda item:item[2]*item[3])[0];resize(p.d,win,0,0,1280,900);p.focus(win);time.sleep(3)
                x11.screenshot(p,profile/'initial.png');print('Window ready',windows,flush=True)
                open_file('bench0000.ts',targets['bench0000.ts']);print('Initial source verified',appname,flush=True);time.sleep(20)
                row['verificationControlMs']=[]
                for control in range(3):
                    control_start=time.perf_counter();until_buffer(targets['bench0000.ts'],15);row['verificationControlMs'].append((time.perf_counter()-control_start)*1000)
                for i in range(1,7): row['quickOpenMs'].append(open_file(f'bench{i:04d}.ts',targets[f'bench{i:04d}.ts']))
                # Verify both ends of the large document using native navigation.
                settle();start=time.perf_counter();picker('p');query_text('large.ts');p.key('Return')
                def selected_line(last=False):
                    x11.click(p);time.sleep(.03)
                    p.key('End' if last else 'Home',('Control_L',))
                    if last:p.key('Up')
                    p.key('Home');p.key('End',('Shift_L',));p.key('c',('Control_L',));time.sleep(.025)
                    return p.clipboard()
                deadline=time.monotonic()+20
                while selected_line()!='// benchmark large document':
                    if time.monotonic()>deadline:raise RuntimeError('Large document first-line verification failed')
                    time.sleep(.05)
                while selected_line(True)!='// row 39999 value':
                    if time.monotonic()>deadline:raise RuntimeError('Large document EOF verification failed')
                    time.sleep(.05)
                row['largeFileOpenMs'].append((time.perf_counter()-start)*1000);p.key('Right')
                time.sleep(2)
                memory=[];row['processSamples']=[]
                for n in range(5):
                    file=profile/f'pss-{n}.json';subprocess.run(['node',str(repo/'scripts/performance/app-memory.cjs'),str(child.pid),str(file)],check=True,stdout=subprocess.DEVNULL);sample=json.loads(file.read_text())
                    row['processSamples'].append(sample)
                    if sample['complete']:memory.append(sample['totals']['pssKiB']/1024)
                    else:report['rejected'].append({'app':appname,'repeat':repeat,'sample':sample})
                    time.sleep(.1)
                if not memory:raise RuntimeError('No complete PSS samples')
                row['settledPssMiB']=statistics.median(memory);row['pssSamplesMiB']=memory;row['displayEnumerationRaces']=list(x11.errors)
                if any(not item['enumerating'] for item in x11.errors):raise RuntimeError('Display error outside window discovery')
                row['passed']=True
                print('Completed',appname,repeat,json.dumps({key:value for key,value in row.items() if key!='processSamples'}),flush=True)
                if repeat==0:x11.screenshot(p,profile/'verified.png')
            except Exception:
                try:x11.screenshot(p,profile/'failure.png')
                except Exception:pass
                raise
            finally:
                try:os.killpg(child.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                try:child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid,signal.SIGKILL);child.wait()
                log.close();write_report();time.sleep(1)
                assert not Path('/proc/'+str(child.pid)).exists(), 'App root did not exit'
                assert fixture_hash()==manifest.hexdigest(), 'Editor changed benchmark files'
                assert fingerprint()==report['sources'] and build_hash()==report['uiBuildSha256'], 'Source/build changed'
    report['summary']={name:{'quickOpenMedianMs':statistics.median([v for r in report['runs'] if r['app']==name for v in r['quickOpenMs']]),'largeFileOpenMedianMs':statistics.median([v for r in report['runs'] if r['app']==name for v in r['largeFileOpenMs']]),'settledPssMedianMiB':statistics.median([r['settledPssMiB'] for r in report['runs'] if r['app']==name])} for name in args.apps.split(',')}
    report['complete']=True;write_report();print(json.dumps(report['summary']),flush=True)
except Exception as error:
    report['failure']=str(error);write_report();raise
