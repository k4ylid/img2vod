import type { SmokeRunPayload } from '../shared/api';
import type { Camera, Project, Shot } from '../shared/types';
import { RESOLUTION_DIMS } from '../shared/types';
import { EASING_PRESETS, evaluateCamera, projectDuration, viewRect } from '../shared/engine';
import { FrameRenderer } from './render/FrameRenderer';
import { exportVideo } from './export/exportVideo';

const IMG_W = 2400;
const IMG_H = 1600;
const MARKER = { x: 360, y: 240, size: 140 }; // bright square, top-left quadrant, image px

function drawTestImage(): string {
  const c = document.createElement('canvas');
  c.width = IMG_W;
  c.height = IMG_H;
  const ctx = c.getContext('2d');
  if (!ctx) {
    throw new Error('no 2d context');
  }
  const grad = ctx.createLinearGradient(0, 0, IMG_W, IMG_H);
  grad.addColorStop(0, '#1a2f5a');
  grad.addColorStop(0.5, '#28421f');
  grad.addColorStop(1, '#5a1a2f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, IMG_W, IMG_H);

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '28px sans-serif';
  for (let x = 0; x <= IMG_W; x += 200) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, IMG_H);
    ctx.stroke();
    if (x > 0) {
      ctx.fillText(String(x), x + 6, 34);
    }
  }
  for (let y = 0; y <= IMG_H; y += 200) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(IMG_W, y);
    ctx.stroke();
    if (y > 0) {
      ctx.fillText(String(y), 6, y + 30);
    }
  }

  // Orientation marker: bright yellow square in the top-left quadrant.
  ctx.fillStyle = '#ffe11a';
  ctx.fillRect(MARKER.x - MARKER.size / 2, MARKER.y - MARKER.size / 2, MARKER.size, MARKER.size);
  // Dark square in the bottom-right quadrant as a counter-check.
  ctx.fillStyle = '#101010';
  ctx.fillRect(IMG_W - 430, IMG_H - 310, 140, 140);
  return c.toDataURL('image/png');
}

function shot(partial: Partial<Shot> & { camera: Camera }): Shot {
  return {
    id: crypto.randomUUID(),
    name: 'smoke',
    move: 0,
    hold: 1,
    moveKind: 'direct',
    easing: { ...EASING_PRESETS.smooth },
    holdMotion: { type: 'none' },
    motionBlur: false,
    ...partial,
  };
}

/** 2 scenes, exactly 4.0s: direct + arc + cut moves, microPush + drift holds. */
function smokeProject(imagePath: string): Project {
  const imageId = 'smoke-image';
  return {
    version: 1,
    name: 'smoke',
    settings: { resolution: '1080p', fps: 30 },
    images: [{ id: imageId, path: imagePath, name: 'smoke-image.png', width: IMG_W, height: IMG_H }],
    scenes: [
      {
        id: 'smoke-scene-1',
        imageId,
        shots: [
          shot({
            name: 's1a',
            move: 0,
            hold: 1,
            camera: { cx: 0.5, cy: 0.5, zoom: 1 },
            holdMotion: { type: 'microPush', amount: 0.05 },
          }),
          shot({
            name: 's1b',
            move: 1,
            hold: 0.5,
            moveKind: 'direct',
            camera: { cx: 0.7, cy: 0.3, zoom: 2 },
            holdMotion: { type: 'drift', amount: 0.01 },
            motionBlur: true,
          }),
        ],
      },
      {
        id: 'smoke-scene-2',
        imageId,
        shots: [
          shot({ name: 's2a', move: 0.5, hold: 0.25, moveKind: 'cut', camera: { cx: 0.25, cy: 0.7, zoom: 1.6 } }),
          shot({
            name: 's2b',
            move: 0.5,
            hold: 0.25,
            moveKind: 'arc',
            arcZoom: 0.9,
            camera: { cx: 0.8, cy: 0.75, zoom: 1.2 },
          }),
        ],
      },
    ],
    markers: [],
  };
}

async function runSmoke(payload: SmokeRunPayload): Promise<string> {
  const project = smokeProject(await window.fvod.saveSmokeImage(drawTestImage()));
  const dims = RESOLUTION_DIMS[payload.resolution];
  project.settings.resolution = payload.resolution;
  project.settings.fps = payload.fps;
  if (payload.audioPath) {
    project.audio = { path: payload.audioPath, includeInExport: true };
  }

  // Orientation / size sanity check at export resolution before exporting.
  const check = await FrameRenderer.create({ width: dims.width, height: dims.height });
  try {
    await check.loadImages(project.images);
    check.renderAt(project, 0);
    const px = check.readPixels();
    if (px.length !== dims.width * dims.height * 4) {
      throw new Error(`readPixels returned ${px.length} bytes, expected ${dims.width * dims.height * 4}`);
    }
    const scene = project.scenes[0];
    const cam = evaluateCamera(scene, 0);
    const vr = viewRect(project.images[0], cam, dims.width, dims.height);
    const sx = Math.round((MARKER.x - vr.x) * vr.effectiveScale);
    const sy = Math.round((MARKER.y - vr.y) * vr.effectiveScale);
    if (sy >= dims.height / 2) {
      throw new Error(`marker landed in bottom half (y=${sy}) — readPixels orientation is wrong`);
    }
    const idx = (Math.min(sy, dims.height - 1) * dims.width + Math.min(sx, dims.width - 1)) * 4;
    if (!(px[idx] > 180 && px[idx + 1] > 160 && px[idx + 2] < 120)) {
      throw new Error(
        `marker pixel at (${sx},${sy}) is rgb(${px[idx]},${px[idx + 1]},${px[idx + 2]}), expected bright yellow`,
      );
    }
  } finally {
    check.destroy();
  }

  const controller = new AbortController();
  const result = await exportVideo(project, payload.outputPath, { signal: controller.signal });
  const dur = projectDuration(project);
  return `exported ${result.frames} frames (${dur.toFixed(2)}s @ ${payload.fps}fps) via ${result.encoder} -> ${payload.outputPath}`;
}

export function registerSmokeRun(): void {
  if (!window.fvod) {
    return;
  }
  window.fvod.onSmokeRun((payload) => {
    runSmoke(payload)
      .then((msg) => window.fvod.smokeDone(true, msg))
      .catch((err) => window.fvod.smokeDone(false, err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)));
  });
}
