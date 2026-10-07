import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ExportStartOpts, FvodApi, SmokeRunPayload } from '../shared/api';

const api: FvodApi = {
  pickImages: () => ipcRenderer.invoke('fvod:pick-images'),
  pickAudio: () => ipcRenderer.invoke('fvod:pick-audio'),
  saveMp4: (defaultName: string) => ipcRenderer.invoke('fvod:save-mp4', defaultName),
  saveProject: (json: string, path: string | null) => ipcRenderer.invoke('fvod:save-project', json, path),
  openProject: () => ipcRenderer.invoke('fvod:open-project'),
  revealInFolder: (p: string) => ipcRenderer.invoke('fvod:reveal', p),
  setDirty: (dirty: boolean) => ipcRenderer.send('fvod:set-dirty', dirty),
  confirmDiscard: () => ipcRenderer.invoke('fvod:confirm-discard'),
  onSaveAndClose: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('fvod:save-and-close', listener);
    return () => ipcRenderer.removeListener('fvod:save-and-close', listener);
  },
  closeWindow: () => ipcRenderer.send('fvod:close-now'),
  exportStart: (opts: ExportStartOpts) => ipcRenderer.invoke('fvod:export-start', opts),
  exportWriteFrame: (buf: ArrayBuffer) => ipcRenderer.invoke('fvod:export-frame', buf),
  exportEnd: () => ipcRenderer.invoke('fvod:export-end'),
  exportCancel: () => ipcRenderer.invoke('fvod:export-cancel'),
  saveSmokeImage: (dataUrl: string) => ipcRenderer.invoke('fvod:smoke-save-image', dataUrl),
  onSmokeRun: (cb: (payload: SmokeRunPayload) => void) => {
    const listener = (_e: IpcRendererEvent, payload: SmokeRunPayload) => cb(payload);
    ipcRenderer.on('smoke:run', listener);
    return () => ipcRenderer.removeListener('smoke:run', listener);
  },
  smokeDone: (ok: boolean, message?: string) => ipcRenderer.send('smoke:done', ok, message),
};

contextBridge.exposeInMainWorld('fvod', api);
