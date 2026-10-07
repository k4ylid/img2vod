import { describe, expect, it } from 'vitest';
import { viewRect } from './viewRect';

const img = { width: 2400, height: 1600 }; // 3:2

describe('viewRect', () => {
  it('zoom 1 centers the contain-fit view', () => {
    // outW/imgW = 1920/2400 = 0.8, outH/imgH = 1080/1600 = 0.675 -> baseScale 0.675
    const vr = viewRect(img, { cx: 0.5, cy: 0.5, zoom: 1 }, 1920, 1080);
    expect(vr.effectiveScale).toBeCloseTo(0.675, 6);
    expect(vr.height).toBeCloseTo(1600, 6);
    expect(vr.width).toBeCloseTo(1920 / 0.675, 6);
    // View wider than image -> centered horizontally.
    expect(vr.x + vr.width / 2).toBeCloseTo(1200, 4);
    expect(vr.y).toBeCloseTo(0, 6);
  });

  it('zoom 2 shows half the image and honors the center', () => {
    const vr = viewRect(img, { cx: 0.5, cy: 0.5, zoom: 2 }, 1920, 1080);
    expect(vr.effectiveScale).toBeCloseTo(1.35, 6);
    expect(vr.height).toBeCloseTo(800, 6);
    expect(vr.width).toBeCloseTo(1920 / 1.35, 6);
    expect(vr.x + vr.width / 2).toBeCloseTo(1200, 4);
    expect(vr.y + vr.height / 2).toBeCloseTo(800, 4);
  });

  it('clamps the center so the view never leaves the image', () => {
    const vr = viewRect(img, { cx: 0, cy: 0, zoom: 2 }, 1920, 1080);
    expect(vr.x).toBeCloseTo(0, 6);
    expect(vr.y).toBeCloseTo(0, 6);

    const vr2 = viewRect(img, { cx: 1, cy: 1, zoom: 2 }, 1920, 1080);
    expect(vr2.x + vr2.width).toBeCloseTo(2400, 4);
    expect(vr2.y + vr2.height).toBeCloseTo(1600, 4);
  });

  it('centers on axes where the view exceeds the image', () => {
    // Very zoomed out: view wider than the image horizontally.
    const vr = viewRect(img, { cx: 0.1, cy: 0.9, zoom: 0.5 }, 1920, 1080);
    expect(vr.x + vr.width / 2).toBeCloseTo(1200, 4);
    // Vertically the view (2160px) still exceeds the image (1600px) too -> centered.
    expect(vr.y + vr.height / 2).toBeCloseTo(800, 4);
  });

  it('reports effectiveScale > 1 when upscaling', () => {
    const vr = viewRect({ width: 100, height: 100 }, { cx: 0.5, cy: 0.5, zoom: 1 }, 1920, 1080);
    expect(vr.effectiveScale).toBeCloseTo(10.8, 6);
    expect(vr.effectiveScale).toBeGreaterThan(1);
  });

  it('keeps a 16:9 view aspect for a 16:9 output', () => {
    const vr = viewRect(img, { cx: 0.3, cy: 0.7, zoom: 3 }, 1280, 720);
    expect(vr.width / vr.height).toBeCloseTo(16 / 9, 6);
  });
});
