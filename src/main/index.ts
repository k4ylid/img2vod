import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExportStartOpts, SmokeRunPayload } from '../shared/api';
import type { Fps, Resolution } from '../shared/types';
import { detectEncoder, ExportSession, type EncoderName } from './ffmpeg';
import { imageSize } from './imageSize';

// Must run before app is ready: allows fvod-file:// to be used by <img>/fetch
// in the renderer like a normal safe scheme.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'fvod-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

// Optional CDP port for automated console checks (FRAMEVOD_CDP=1 npm run dev).
if (process.env.FRAMEVOD_CDP === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

function argValue(flag: string): string | undefined {
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === flag) {
      return process.argv[i + 1];
    }
    if (a.startsWith(`${flag}=`)) {
      return a.slice(flag.length + 1);
    }
  }
  return undefined;
}

const smokePayload: SmokeRunPayload | null = (() => {
  const out = argValue('--smoke-export');
  if (!out) {
    return null;
  }
  const res = argValue('--smoke-res');
  const fps = Number(argValue('--smoke-fps') ?? '30');
  const audio = argValue('--smoke-audio');
  return {
    outputPath: path.resolve(out),
    resolution: res === '720p' ? '720p' : ('1080p' as Resolution),
    fps: ([24, 25, 30, 60].includes(fps) ? fps : 30) as Fps,
    audioPath: audio ? path.resolve(audio) : undefined,
  };
})();

let mainWindow: BrowserWindow | null = null;
let currentExport: ExportSession | null = null;
let projectDirty = false;
let forceClose = false;

/** Converts an absolute filesystem path into a fvod-file:// URL. */
export function fileToFvodUrl(filePath: string): string {
  const withSlashes = filePath.replace(/\\/g, '/');
  const prefixed = withSlashes.startsWith('/') ? withSlashes : `/${withSlashes}`;
  return `fvod-file://${encodeURI(prefixed).replace(/[?#]/g, (c) => encodeURIComponent(c))}`;
}

function fvodUrlToFile(url: string): string {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname);
  // Windows URLs look like fvod-file:///C:/dir/file.png -> pathname /C:/dir/file.png
  if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) {
    p = p.slice(1);
  }
  return p;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: !smokePayload,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('close', (e) => {
    if (!projectDirty || forceClose || smokePayload) {
      return;
    }
    e.preventDefault();
    if (!mainWindow) {
      return;
    }
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes to the current project?',
    });
    if (choice === 0) {
      // Renderer saves, then sends fvod:close-now (stays open if the save is cancelled).
      mainWindow.webContents.send('fvod:save-and-close');
    } else if (choice === 1) {
      forceClose = true;
      mainWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  if (smokePayload) {
    // Forward renderer failures so a stuck smoke run leaves a trace on stdout.
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.log(`[smoke] did-fail-load ${code} ${desc} ${url}`);
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.log(`[smoke] render-process-gone ${details.reason}`);
    });
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log(`[renderer] ${message}`);
    });
    mainWindow.webContents.once('did-finish-load', () => {
      console.log(`[smoke] starting export -> ${smokePayload.outputPath}`);
      mainWindow?.webContents.send('smoke:run', smokePayload);
    });
  }
}

function registerIpc(): void {
  ipcMain.handle('fvod:pick-images', async () => {
    if (!mainWindow) {
      return [];
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (result.canceled) {
      return [];
    }
    const out: { path: string; name: string; width: number; height: number }[] = [];
    for (const p of result.filePaths) {
      try {
        const { width, height } = imageSize(p);
        out.push({ path: p, name: path.basename(p), width, height });
      } catch (err) {
        console.warn(`[fvod] skipped unreadable image ${p}: ${String(err)}`);
      }
    }
    return out;
  });

  ipcMain.handle('fvod:pick-audio', async () => {
    if (!mainWindow) {
      return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose audio',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }],
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle('fvod:save-mp4', async (_e, defaultName: string) => {
    if (!mainWindow) {
      return null;
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export video',
      defaultPath: defaultName,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  });

  ipcMain.handle('fvod:save-project', async (_e, json: string, filePath: string | null) => {
    let target = filePath;
    if (!target) {
      if (!mainWindow) {
        return null;
      }
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save project',
        filters: [{ name: 'FrameVOD project', extensions: ['fvod'] }],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      target = result.filePath;
    }
    fs.writeFileSync(target, json, 'utf8');
    return target;
  });

  ipcMain.handle('fvod:open-project', async () => {
    if (!mainWindow) {
      return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open project',
      properties: ['openFile'],
      filters: [{ name: 'FrameVOD project', extensions: ['fvod'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const p = result.filePaths[0];
    try {
      return { path: p, json: fs.readFileSync(p, 'utf8') };
    } catch (err) {
      console.warn(`[fvod] failed to read project ${p}: ${String(err)}`);
      return null;
    }
  });

  ipcMain.handle('fvod:reveal', async (_e, p: string) => {
    shell.showItemInFolder(p);
  });

  ipcMain.on('fvod:set-dirty', (_e, dirty: boolean) => {
    projectDirty = dirty;
  });

  ipcMain.handle('fvod:confirm-discard', async () => {
    if (!mainWindow) {
      return 'cancel';
    }
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes to the current project?',
    });
    return choice.response === 0 ? 'save' : choice.response === 1 ? 'discard' : 'cancel';
  });

  ipcMain.on('fvod:close-now', () => {
    forceClose = true;
    mainWindow?.close();
  });

  ipcMain.handle('fvod:export-start', async (_e, opts: ExportStartOpts) => {
    if (currentExport) {
      throw new Error('an export is already running');
    }
    const encoder = (opts.encoder as EncoderName | undefined) ?? (await detectEncoder());
    fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
    currentExport = new ExportSession({ ...opts, encoder });
    return { encoder };
  });

  ipcMain.handle('fvod:export-frame', async (_e, data: ArrayBuffer | Uint8Array) => {
    if (!currentExport) {
      throw new Error('no export in progress');
    }
    const buf = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    await currentExport.writeFrame(buf);
  });

  ipcMain.handle('fvod:export-end', async () => {
    const session = currentExport;
    currentExport = null;
    if (!session) {
      return { ok: false, code: null, error: 'no export in progress' };
    }
    const { code, stderr } = await session.finish();
    if (code === 0) {
      return { ok: true, code };
    }
    return { ok: false, code, error: stderr || `ffmpeg exited with code ${code}` };
  });

  ipcMain.handle('fvod:export-cancel', async () => {
    const session = currentExport;
    currentExport = null;
    await session?.cancel();
  });

  ipcMain.handle('fvod:smoke-save-image', async (_e, dataUrl: string) => {
    if (!smokePayload) {
      throw new Error('not in smoke mode');
    }
    const comma = dataUrl.indexOf(',');
    const buf = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    const dir = path.join(app.getPath('temp'), 'framevod-smoke');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'smoke-image.png');
    fs.writeFileSync(file, buf);
    return file;
  });

  ipcMain.on('smoke:done', (_e, ok: boolean, message?: string) => {
    console.log(`[smoke] done ok=${ok} ${message ?? ''}`);
    setTimeout(() => app.exit(ok ? 0 : 1), 300);
  });
}

void app.whenReady().then(() => {
  protocol.handle('fvod-file', async (request) => {
    try {
      const file = fvodUrlToFile(request.url);
      const res = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(res.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } catch (err) {
      console.warn(`[fvod] protocol fetch failed for ${request.url}: ${String(err)}`);
      return new Response('not found', { status: 404 });
    }
  });

  registerIpc();
  createWindow();

  // Pre-warm encoder detection so the first export does not stall.
  void detectEncoder();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

if (smokePayload) {
  // Smoke watchdog: never hang the runner.
  setTimeout(() => {
    console.error('[smoke] timeout');
    app.exit(2);
  }, 240_000).unref();
}
