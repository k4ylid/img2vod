import type { Camera } from '../types';

export interface ViewRect {
  /** Top-left of the visible source-image rect, in image pixels. */
  x: number;
  y: number;
  /** Size of the visible source-image rect, in image pixels. */
  width: number;
  height: number;
  /** Output pixels per source pixel; > 1 means the image is being upscaled (soft). */
  effectiveScale: number;
}

export interface ImageDims {
  width: number;
  height: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Source-image rect (pixels) visible in the 16:9 output.
 * Base fit is contain: baseScale = min(outW/imgW, outH/imgH); scale = baseScale * zoom.
 * The view center is clamped so the view never leaves the image on axes where
 * view <= image; on axes where the view is wider than the image it is centered.
 */
export function viewRect(img: ImageDims, cam: Camera, outW: number, outH: number): ViewRect {
  const baseScale = Math.min(outW / img.width, outH / img.height);
  const scale = baseScale * Math.max(cam.zoom, 1e-6);
  const viewW = outW / scale;
  const viewH = outH / scale;

  let cxPx = cam.cx * img.width;
  let cyPx = cam.cy * img.height;
  cxPx = viewW <= img.width ? clamp(cxPx, viewW / 2, img.width - viewW / 2) : img.width / 2;
  cyPx = viewH <= img.height ? clamp(cyPx, viewH / 2, img.height - viewH / 2) : img.height / 2;

  return {
    x: cxPx - viewW / 2,
    y: cyPx - viewH / 2,
    width: viewW,
    height: viewH,
    effectiveScale: scale,
  };
}
