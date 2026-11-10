const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('theater', {
  pickAudio: () => ipcRenderer.invoke('audio:pick'),
  readAudio: file => ipcRenderer.invoke('audio:read', file),
  saveProject: (project, portable) => ipcRenderer.invoke('project:save', project, portable),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveDraft: draft => ipcRenderer.invoke('draft:save', draft),
  loadDraft: () => ipcRenderer.invoke('draft:load')
});
