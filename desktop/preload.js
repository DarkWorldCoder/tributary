'use strict';
// Exposes a narrow bridge to the UI. The page never gets Node.js or Electron APIs.
const { contextBridge, ipcRenderer } = require('electron');
const listeners = Object.create(null);
let epoch = null, announced = false;
const listening = () => !!listeners.message?.length && !!listeners['message-patch']?.length;
const announce = () => {
  const next = listening();
  if (epoch && next !== announced) { announced = next; ipcRenderer.send('hub-message-ready', epoch, next); }
};
ipcRenderer.on('hub-message-handshake', (_event, value) => {
  if (typeof value !== 'string' || value === epoch) return;
  epoch = value; announced = false; announce();
});
ipcRenderer.on('hub-message', (_event, name, data, token) => {
  if (!token || token.epoch !== epoch || !Number.isSafeInteger(token.id)) return;
  let consumed = listening() && (name === 'message' || name === 'message-patch');
  if (consumed) {
    try { for (const fn of [...listeners[name]]) fn(data); }
    catch (error) { consumed = false; console.error('Could not apply chat update:', error?.message || String(error)); }
  }
  // Acknowledge dispatch, not paint. Hidden windows must not depend on animation frames.
  queueMicrotask(() => ipcRenderer.send('hub-message-ack', token, consumed));
});
ipcRenderer.on('hub-event', (_e, name, data) => { for (const f of listeners[name] || []) f(data); });
contextBridge.exposeInMainWorld('hub', {
  platform: 'desktop',
  os: process.platform,
  call: (method, ...args) => ipcRenderer.invoke('hub', method, args),
  on: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); announce(); return () => { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); announce(); }; },
});
