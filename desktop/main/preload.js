'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('uw', {
  boot: call('app:boot'),
  saveSettings: call('settings:save'),
  detectEngine: call('engine:detect'),
  listProjects: call('projects:list'),
  createProject: call('projects:create'),
  openProject: call('projects:open'),
  deleteProject: call('projects:delete'),
  listFiles: call('files:list'),
  readFile: call('files:read'),
  checkFile: call('files:check'),
  send: call('run:send'),
  record: call('run:record'),
  interrupt: call('run:interrupt'),
  stop: call('run:stop'),
  respondPermission: call('perm:respond'),
  buildHandoff: call('handoff:build'),
  reveal: call('shell:reveal'),
  openPath: call('shell:open'),
  openExternal: call('shell:external'),
  copy: call('clipboard:write'),
  pickDir: call('dialog:pickDir'),
  pickAny: call('dialog:pickAny'),
  openTerminal: call('shell:terminal'),
  readFigma: call('figma:read'),
  openFigma: call('figma:open'),
  onRunEvent: (fn) => { const h = (_e, p) => fn(p); ipcRenderer.on('run:event', h); return () => ipcRenderer.removeListener('run:event', h); },
  onFilesChanged: (fn) => { const h = (_e, p) => fn(p); ipcRenderer.on('files:changed', h); return () => ipcRenderer.removeListener('files:changed', h); },
  onAltKey: (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on('alt:key', h); return () => ipcRenderer.removeListener('alt:key', h); },
  onFigmaChanged: (fn) => { const h = (_e, p) => fn(p); ipcRenderer.on('figma:changed', h); return () => ipcRenderer.removeListener('figma:changed', h); },
});
