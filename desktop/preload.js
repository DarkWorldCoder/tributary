'use strict';
// Exposes a narrow bridge to the UI. The page never gets Node.js or Electron APIs.
const { contextBridge, ipcRenderer } = require('electron');
const listeners = {};
ipcRenderer.on('hub-event', (_e, name, data) => { for (const f of listeners[name] || []) f(data); });
contextBridge.exposeInMainWorld('hub', {
  platform: 'desktop',
  call: (method, ...args) => ipcRenderer.invoke('hub', method, args),
  on: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return () => { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); }; },
});
