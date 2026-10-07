import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ExportStartOpts, FvodApi, SmokeRunPayload } from '../shared/api';

const api: FvodApi = {
  pickImages: () => ipcRenderer.invoke('fvod:pick-images'),
  saveMp4: (defaultName: string) => ipcRenderer.invoke('fvod:save-mp4', defaultName),
  saveProject: (json: string, path: string | null) => ipcRenderer.invoke('fvod:save-project', json, path),
  openProject: () => ipcRenderer.invoke('fvod:open-project'),
  revealInFolder: (p: string) => ipcRenderer.invoke('fvod:reveal', p),
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
