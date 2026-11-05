"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { app } = require("electron");
const repo = path.resolve(__dirname, "../..");
const output = process.env.TRIBUTARY_GRAPHICS_OUTPUT;
if (!output || !path.isAbsolute(output))
  throw Error("Set an absolute TRIBUTARY_GRAPHICS_OUTPUT path.");
const core = require(path.join(repo, "core"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tributary-gl-baseline-"));
const profile = path.join(root, "profile"),
  project = path.join(root, "project");
fs.mkdirSync(project);
fs.writeFileSync(
  path.join(project, "README.md"),
  "# Graphics resource fixture\n",
);
process.env.TRIBUTARY_DATA_DIR = profile;
process.env.SHELL = "/bin/sh";
const seed = new core.SqliteStore(profile, {
  version: 1,
  projects: [{ path: project, name: "Graphics fixture", trusted: true }],
  threads: [],
  gateways: [],
  notifications: [],
  settings: { mode: "read" },
});
seed.data.projects = [
  { path: project, name: "Graphics fixture", trusted: true },
];
seed.save(true);
seed.close();
const Base = core.Hub;
core.Hub = class extends Base {
  async init() {
    this.agents = [];
    this.scanningAgents = false;
    this.emit("state");
    return this;
  }
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let started = false;
const hook = String.raw`(()=>{const records=[],seen=new WeakSet(),original=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(...args){const gl=original.apply(this,args);if(gl&&/^webgl2?$/.test(args[0])&&!seen.has(gl)){seen.add(gl);const record={context:new WeakRef(gl),canvas:new WeakRef(this),created:{},deleted:{},losses:0};records.push(record);this.addEventListener('webglcontextlost',()=>record.losses++);for(const kind of ['Buffer','Texture','Program','Shader','VertexArray','Framebuffer','Renderbuffer']){const make=gl['create'+kind],drop=gl['delete'+kind];if(!make||!drop)continue;const live=new WeakSet();gl['create'+kind]=function(...values){const result=make.apply(this,values);if(result){live.add(result);record.created[kind]=(record.created[kind]||0)+1;}return result;};gl['delete'+kind]=function(value){if(value&&live.has(value)){live.delete(value);record.deleted[kind]=(record.deleted[kind]||0)+1;}return drop.call(this,value);};}}return gl;};window.__graphicsLoseVisible=()=>{const r=records.find(r=>r.canvas.deref()?.getClientRects().length&&r.context.deref()&&!r.context.deref().isContextLost());if(!r)throw Error('No visible context');r.context.deref().getExtension('WEBGL_lose_context').loseContext();return records.length;};window.__graphicsSample=()=>records.map(r=>{const gl=r.context.deref(),canvas=r.canvas.deref();return {alive:!!gl,lost:gl?gl.isContextLost():null,attached:!!canvas?.isConnected,visible:!!canvas?.getClientRects().length,lossEvents:r.losses,created:r.created,deleted:r.deleted,liveHandles:Object.fromEntries(Object.entries(r.created).map(([kind,count])=>[kind,count-(r.deleted[kind]||0)]))};});})()`;
app.on("browser-window-created", (_event, win) =>
  win.webContents.once("did-finish-load", () => {
    if (started) return;
    started = true;
    void (async () => {
      const web = win.webContents;
      const evaluate = async (code) => web.executeJavaScript(code);
      const until = async (code, label) => {
        const end = Date.now() + 20000;
        while (!(await evaluate(code))) {
          if (Date.now() > end) throw Error("Timed out: " + label);
          await delay(75);
        }
      };
      web.debugger.attach("1.3");
      await web.debugger.sendCommand("Page.enable");
      await web.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: hook,
      });
      await evaluate(
        `localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.terminal','false')`,
      );
      const loaded = new Promise((resolve) =>
        web.once("did-finish-load", resolve),
      );
      web.reload();
      await loaded;
      await until(
        '!!window.hub && !!document.querySelector("button[aria-label=Terminal]")',
        "terminal launcher",
      );
      const click = (label) =>
        evaluate(
          `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}&&b.getClientRects().length);if(!b)throw Error('Missing button');b.click();return true})()`,
        );
      await click("Terminal");
      await until(
        'document.querySelectorAll(".xterm").length===1',
        "first terminal",
      );
      const sidebarOpen = await evaluate(`document.querySelector('button[aria-label="Projects and chats"]')?.getAttribute('aria-expanded')==='true'`);
      if (sidebarOpen) await click("Projects and chats");
      win.focus();
      const searchChecks = [];
      const samples = [];
      const snapshot = async (label) => {
        await delay(100);
        samples.push({
          label,
          at: new Date().toISOString(),
          contexts: await evaluate("window.__graphicsSample()"),
          shells: await evaluate(
            'window.hub.call("termList").then(list=>list.length)',
          ),
          heap: await web.debugger.sendCommand("Runtime.getHeapUsage"),
        });
        console.log(
          "GRAPHICS_STAGE " +
            JSON.stringify({
              label,
              shells: samples.at(-1).shells,
              activeContexts: samples
                .at(-1)
                .contexts.filter((c) => c.alive && !c.lost).length,
            }),
        );
      };
      await snapshot("one-visible");
      for (let i = 2; i <= 8; i++) {
        await click("New terminal");
        await until(
          `document.querySelectorAll('.xterm').length===${i}`,
          "create " + i,
        );
      }
      await snapshot("eight-tabs-one-visible");
      await click("Hide terminal");
      await snapshot("eight-tabs-panel-hidden");
      await click("Terminal");
      await snapshot("reopened");
      const ids = await evaluate(
        'window.hub.call("termList").then(list=>list.map(t=>t.id))',
      );
      // Generate unique off-screen rows through each real shell, while most renderers
      // are hidden. Search checks the retained parser/scrollback, not screenshots alone.
      for (let i = 0; i < ids.length; i++) {
        const command = `i=0; while [ "$i" -lt 120 ]; do printf 'fixture${i}-keep-%03d\\n' "$i"; i=$((i+1)); done; printf '\\033[32mUTF8-★-${i}\\033[0m\\n'\r`;
        await evaluate(
          `window.hub.call('termWrite',${JSON.stringify(ids[i])},${JSON.stringify(command)})`,
        );
      }
      await delay(300);
      for (let cycle = 0; cycle < 2; cycle++) {
        for (let i = 0; i < 8; i++) {
          const name = `Shell ${i + 1}`;
          const position = await evaluate(`(()=>{const b=[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()===${JSON.stringify(name)});if(!b)throw Error('Missing terminal tab');b.scrollIntoView({block:'nearest',inline:'nearest'});const r=b.getBoundingClientRect();const x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);if(document.elementFromPoint(x,y)?.closest('[role=tab]')!==b)throw Error('Terminal tab covered');return {x,y}})()`);
          web.sendInputEvent({ type: "mouseDown", ...position, button: "left", clickCount: 1 });
          web.sendInputEvent({ type: "mouseUp", ...position, button: "left", clickCount: 1 });
          await until(`document.querySelector('[aria-label=Terminals] [aria-selected=true]')?.textContent.trim()===${JSON.stringify(name)}`, "select " + name);
          await delay(100);
          await click("Find in terminal");
          await until(
            '!!document.querySelector(".terminal-find input:focus")',
            "search focus",
          );
          await web.insertText(`fixture${i}-keep-017`);
          await until(
            `(()=>{const el=[...document.querySelectorAll('.terminal-find-results')].find(e=>e.getClientRects().length);return el?.textContent==='1 of 1'})()`,
            "unique saved output search " + i,
          );
          searchChecks.push({
            cycle,
            tab: i,
            query: `fixture${i}-keep-017`,
            result: "1 of 1",
          });
          await click("Close find");
        }
        await click("Hide terminal");
        await snapshot("cycle-" + cycle + "-hidden");
        await click("Terminal");
        await snapshot("cycle-" + cycle + "-visible");
      }
      const sameIds = await evaluate(
        `window.hub.call('termList').then(list=>JSON.stringify(list.map(t=>t.id))===${JSON.stringify(JSON.stringify(ids))})`,
      );
      if (!sameIds) throw Error("Shells changed across renderer cycles");
      for (let i = 1; i <= 3; i++) {
        await click("Split terminal");
        await until(
          `document.querySelectorAll('.xterm').length===${8 + i}`,
          "split pane",
        );
      }
      await snapshot("four-visible-splits");
      const splitSample = samples.at(-1);
      if (splitSample.contexts.filter((c) => c.alive && !c.lost).length !== 4)
        throw Error("Expected four visible graphics contexts");
      const countBeforeLoss = await evaluate("window.__graphicsLoseVisible()");
      await until(
        `(()=>{const list=window.__graphicsSample();return list.length>${countBeforeLoss}&&list.filter(c=>c.alive&&!c.lost).length===4})()`,
        "context-loss recovery",
      );
      await snapshot("context-loss-recovered");
      await evaluate("window.__graphicsLoseVisible()");
      await click("Hide terminal");
      await snapshot("loss-then-hide");
      const hiddenCount = await evaluate("window.__graphicsSample().length");
      await delay(4500);
      if ((await evaluate("window.__graphicsSample().length")) !== hiddenCount)
        throw Error("Hidden pane recreated its graphics context");
      await snapshot("hidden-after-loss-deadline");
      await click("Terminal");
      await snapshot("splits-reopened");

      const report = {
        date: new Date().toISOString(),
        runtime: {
          electron: process.versions.electron,
          node: process.versions.node,
          platform: process.platform,
        },
        instrumentation:
          "WebGL create/delete counters and weak context/canvas references injected before page startup; no resource handles retained by the probe; no forced GC",
        scope: [
          "Software ANGLE/SwiftShader under Xvfb, not physical GPU VRAM",
          "Diagnostic wrapper and CDP add overhead; counts are actual API calls, not byte allocation",
          "Eight real PTY tabs, then four split panes; hidden shells remain alive; unique saved rows are checked with terminal search",
        ],
        sourceHashes: Object.fromEntries(
          [
            "ui/src/components/terminal-view.tsx",
            "ui/src/components/terminal-panel.tsx",
            "core/terminal.js",
            "ui/src/lib/terminal-renderer.mjs",
            "scripts/performance/native-terminal-graphics.cjs",
          ].map((f) => [
            f,
            crypto
              .createHash("sha256")
              .update(fs.readFileSync(path.join(repo, f)))
              .digest("hex"),
          ]),
        ),
        searchChecks,
        sameShellIds: sameIds,
        samples,
      };
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
      console.log(
        JSON.stringify(
          samples.map((s) => ({
            label: s.label,
            shells: s.shells,
            contexts: s.contexts.filter((c) => c.alive && !c.lost).length,
            attached: s.contexts.filter((c) => c.attached).length,
            visible: s.contexts.filter((c) => c.visible).length,
          })),
        ),
      );
      web.debugger.detach();
      app.quit();
    })().catch((e) => {
      console.error(e.stack);
      process.exitCode = 1;
      app.quit();
    });
  }),
);
app.on("quit", () => fs.rmSync(root, { recursive: true, force: true }));
require(path.join(repo, "desktop/main.js"));

// Electron's quit defaults to zero even when Node's exitCode was set. Preserve
// diagnostic failures after the normal window/PTY shutdown has run.
app.on("will-quit", () => {
  if (process.exitCode) {
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(process.exitCode);
  }
});
