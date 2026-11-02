// Runs in the webview before the app: exposes window.hub over VS Code's message channel.
(function () {
  const vscode = acquireVsCodeApi();
  const listeners = {}; const pending = new Map(); let next = 1;
  window.addEventListener('message', (e) => {
    const m = e.data; if (!m) return;
    if (m.type === 'result' && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result); }
    else if (m.type === 'event') (listeners[m.name] || []).forEach((f) => f(m.data));
  });
  window.hub = {
    platform: 'vscode',
    call(method, ...args) { const id = next++; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); vscode.postMessage({ type: 'call', id, method, args }); }); },
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return () => { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); }; },
  };
})();
