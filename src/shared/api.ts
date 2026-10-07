import type { Fps, Resolution } from './types';

export interface ImportedImage {
  path: string;
  name: string;
  width: number;
  height: number;
}

export interface ExportStartOpts {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  /** undefined = auto-detect (HW preferred, libx264 fallback) */
  encoder?: string;
  audioPath?: string;
}

export interface ExportEndResult {
  ok: boolean;
  code: number | null;
  error?: string;
}

export interface SmokeRunPayload {
  outputPath: string;
  resolution: Resolution;
  fps: Fps;
}

/** API exposed to the renderer as window.fvod via the preload contextBridge. */
export interface FvodApi {
  pickImages(): Promise<ImportedImage[]>;
  saveMp4(defaultName: string): Promise<string | null>;
  saveProject(json: string, path: string | null): Promise<string | null>;
  openProject(): Promise<{ path: string; json: string } | null>;
  revealInFolder(path: string): Promise<void>;
  exportStart(opts: ExportStartOpts): Promise<{ encoder: string }>;
  exportWriteFrame(buf: ArrayBuffer): Promise<void>;
  exportEnd(): Promise<ExportEndResult>;
  exportCancel(): Promise<void>;
  saveSmokeImage(dataUrl: string): Promise<string>;
  onSmokeRun(cb: (payload: SmokeRunPayload) => void): () => void;
  smokeDone(ok: boolean, message?: string): void;
}
