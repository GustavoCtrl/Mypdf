// Ponte segura entre a interface e o processo principal.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mypdfNative', {
  platform: process.platform,
  saveFile: (name, bytes) => ipcRenderer.invoke('file:save', name, bytes),
  saveFiles: (files) => ipcRenderer.invoke('file:saveMany', files),
  showInFolder: (p) => ipcRenderer.invoke('file:showInFolder', p),
  converterStatus: () => ipcRenderer.invoke('convert:status'),
  pickConverter: () => ipcRenderer.invoke('convert:pick'),
  openDownloadPage: () => ipcRenderer.invoke('convert:download'),
  convertToPdf: (name, bytes) => ipcRenderer.invoke('convert:toPdf', name, bytes),
});
