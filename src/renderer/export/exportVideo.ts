import type { Project } from '../../shared/types';
import { RESOLUTION_DIMS } from '../../shared/types';
import { exportFrameCount, frameTime, projectDuration } from '../../shared/engine';
import { FrameRenderer } from '../render/FrameRenderer';

export interface ExportCallbacks {
  onProgress?: (frame: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  encoder: string;
  frames: number;
}

/**
 * Renders every frame through an offscreen FrameRenderer at export size and
 * pipes the RGBA bytes to ffmpeg (one awaited write per frame, backpressure
 * handled in the main process). Deterministic: frame i is rendered at i/fps.
 */
export async function exportVideo(
  project: Project,
  outputPath: string,
  { onProgress, signal }: ExportCallbacks = {},
): Promise<ExportResult> {
  const dims = RESOLUTION_DIMS[project.settings.resolution];
  const fps = project.settings.fps;
  const total = exportFrameCount(projectDuration(project), fps);

  const renderer = await FrameRenderer.create({ width: dims.width, height: dims.height });
  try {
    await renderer.loadImages(project.images);
    const { encoder } = await window.fvod.exportStart({
      outputPath,
      width: dims.width,
      height: dims.height,
      fps,
      audioPath: project.audio?.includeInExport ? project.audio.path : undefined,
    });

    try {
      for (let i = 0; i < total; i++) {
        if (signal?.aborted) {
          throw new DOMException('Export aborted', 'AbortError');
        }
        renderer.renderAt(project, frameTime(i, fps));
        const pixels = renderer.readPixels();
        const buf = pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength) as ArrayBuffer;
        await window.fvod.exportWriteFrame(buf);
        onProgress?.(i + 1, total);
      }
    } catch (err) {
      await window.fvod.exportCancel();
      throw err;
    }

    const end = await window.fvod.exportEnd();
    if (!end.ok) {
      throw new Error(end.error ?? `ffmpeg exited with code ${end.code ?? 'unknown'}`);
    }
    return { encoder, frames: total };
  } finally {
    renderer.destroy();
  }
}
