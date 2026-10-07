import { describe, expect, it } from 'vitest';
import type { Camera, Easing, Project, Scene, Shot } from '../types';
import { evaluateCamera, projectDuration, sceneAt, sceneDuration } from './timeline';
import { EASING_PRESETS } from './easing';

const LINEAR: Easing = EASING_PRESETS.linear;

let counter = 0;
function shot(partial: Partial<Shot> & { camera: Camera }): Shot {
  counter += 1;
  return {
    id: `s${counter}`,
    name: `shot-${counter}`,
    move: 1,
    hold: 1,
    moveKind: 'direct',
    easing: LINEAR,
    holdMotion: { type: 'none' },
    motionBlur: false,
    ...partial,
  };
}

function scene(shots: Shot[], id = 'scene1', imageId = 'img1'): Scene {
  return { id, imageId, shots };
}

function project(scenes: Scene[]): Project {
  return {
    version: 1,
    name: 'test',
    settings: { resolution: '1080p', fps: 30 },
    images: [],
    scenes,
    markers: [],
  };
}

describe('projectDuration / sceneAt', () => {
  it('sums move+hold per shot across scenes', () => {
    const p = project([
      scene([shot({ move: 1, hold: 2, camera: { cx: 0.5, cy: 0.5, zoom: 1 } })], 'a'),
      scene(
        [
          shot({ move: 0, hold: 0.5, camera: { cx: 0, cy: 0, zoom: 1 } }),
          shot({ move: 2, hold: 1, camera: { cx: 1, cy: 1, zoom: 2 } }),
        ],
        'b',
      ),
    ]);
    expect(projectDuration(p)).toBeCloseTo(1 + 2 + 0.5 + 2 + 1);
  });

  it('maps global time to the right scene/localT', () => {
    const p = project([
      scene([shot({ move: 0, hold: 2, camera: { cx: 0, cy: 0, zoom: 1 } })], 'a'),
      scene([shot({ move: 0, hold: 3, camera: { cx: 1, cy: 1, zoom: 1 } })], 'b', 'img2'),
    ]);
    expect(sceneAt(p, 1)?.scene.id).toBe('a');
    expect(sceneAt(p, 1)?.localT).toBeCloseTo(1);
    expect(sceneAt(p, 2.5)?.scene.id).toBe('b');
    expect(sceneAt(p, 2.5)?.localT).toBeCloseTo(0.5);
    // Past the end clamps into the last scene.
    const end = sceneAt(p, 999);
    expect(end?.scene.id).toBe('b');
    expect(end?.localT).toBeCloseTo(3);
  });

  it('returns null for empty project', () => {
    expect(sceneAt(project([]), 0)).toBeNull();
  });

  it('sceneDuration is zero for a scene with no shots', () => {
    expect(sceneDuration(scene([]))).toBe(0);
  });
});

describe('evaluateCamera', () => {
  it('first-shot move is treated as 0: camera stays on the target', () => {
    const s = scene([
      shot({ move: 5, hold: 2, camera: { cx: 0.2, cy: 0.8, zoom: 3 } }),
      shot({ move: 1, hold: 1, camera: { cx: 0.9, cy: 0.1, zoom: 1 } }),
    ]);
    const c = evaluateCamera(s, 1.5); // inside shot 1's "move" window
    expect(c).toEqual({ cx: 0.2, cy: 0.8, zoom: 3 });
  });

  it('direct move lerps cx/cy and interpolates zoom in log space', () => {
    const s = scene([
      shot({ move: 0, hold: 2, camera: { cx: 0, cy: 0, zoom: 1 } }),
      shot({ move: 1, hold: 1, camera: { cx: 1, cy: 0.5, zoom: 4 }, easing: LINEAR }),
    ]);
    // Shot 1 occupies [0,2) (move treated as 0 -> hold over 0..1),
    // shot 2 occupies [2,4): move [2,3), hold [3,4).
    const mid = evaluateCamera(s, 2.5); // e = 0.5
    expect(mid.cx).toBeCloseTo(0.5, 6);
    expect(mid.cy).toBeCloseTo(0.25, 6);
    expect(mid.zoom).toBeCloseTo(2, 6); // log midpoint of 1 -> 4 is 2

    const start = evaluateCamera(s, 2);
    expect(start.zoom).toBeCloseTo(1, 6);
    const end = evaluateCamera(s, 2.9999);
    expect(end.zoom).toBeCloseTo(4, 2);
  });

  it('arc move passes through arcZoom at the midpoint', () => {
    const s = scene([
      shot({ move: 0, hold: 2, camera: { cx: 0.2, cy: 0.2, zoom: 2 } }),
      shot({
        move: 2,
        hold: 1,
        camera: { cx: 0.8, cy: 0.8, zoom: 3 },
        moveKind: 'arc',
        arcZoom: 1.2,
        easing: LINEAR,
      }),
    ]);
    const mid = evaluateCamera(s, 2 + 1); // e = 0.5
    expect(mid.zoom).toBeCloseTo(1.2, 4);
    expect(mid.cx).toBeCloseTo(0.5, 6);
    // Endpoints still honored.
    expect(evaluateCamera(s, 2).zoom).toBeCloseTo(2, 4);
    expect(evaluateCamera(s, 3.999).zoom).toBeCloseTo(3, 2);
  });

  it('arc move defaults arcZoom to min(prevZoom, zoom) * 0.87', () => {
    const s = scene([
      shot({ move: 0, hold: 1, camera: { cx: 0.5, cy: 0.5, zoom: 2 } }),
      shot({
        move: 2,
        hold: 0,
        camera: { cx: 0.5, cy: 0.5, zoom: 4 },
        moveKind: 'arc',
        easing: LINEAR,
      }),
    ]);
    const mid = evaluateCamera(s, 2);
    expect(mid.zoom).toBeCloseTo(2 * 0.87, 4);
  });

  it('arc move never pushes zoom above the direct path when arcZoom is high', () => {
    const s = scene([
      shot({ move: 0, hold: 1, camera: { cx: 0.5, cy: 0.5, zoom: 1 } }),
      shot({
        move: 2,
        hold: 0,
        camera: { cx: 0.5, cy: 0.5, zoom: 2 },
        moveKind: 'arc',
        arcZoom: 10, // above both endpoints -> d clamps to 0
        easing: LINEAR,
      }),
    ]);
    const mid = evaluateCamera(s, 2);
    expect(mid.zoom).toBeCloseTo(Math.sqrt(2), 4); // plain log lerp
  });

  it('cut move shows the target camera for the whole shot', () => {
    const s = scene([
      shot({ move: 0, hold: 1, camera: { cx: 0, cy: 0, zoom: 1 } }),
      shot({ move: 2, hold: 1, camera: { cx: 1, cy: 1, zoom: 5 }, moveKind: 'cut' }),
    ]);
    const duringMove = evaluateCamera(s, 2.5); // inside shot 2's nominal move window
    expect(duringMove).toEqual({ cx: 1, cy: 1, zoom: 5 });
  });

  it('microPush grows zoom by amount over the hold', () => {
    const s = scene([
      shot({
        move: 0,
        hold: 2,
        camera: { cx: 0.5, cy: 0.5, zoom: 2 },
        holdMotion: { type: 'microPush', amount: 0.05 },
      }),
    ]);
    expect(evaluateCamera(s, 0).zoom).toBeCloseTo(2, 6);
    expect(evaluateCamera(s, 1.999).zoom).toBeCloseTo(2 * 1.05, 3);
    const mid = evaluateCamera(s, 1);
    expect(mid.zoom).toBeGreaterThan(2);
    expect(mid.zoom).toBeLessThan(2.1);
  });

  it('drift offsets deterministically and starts at the base camera', () => {
    const s = scene([
      shot({
        move: 0,
        hold: 3,
        camera: { cx: 0.5, cy: 0.5, zoom: 2 },
        holdMotion: { type: 'drift', amount: 0.02 },
      }),
    ]);
    const t0 = evaluateCamera(s, 0);
    expect(t0.cx).toBeCloseTo(0.5, 6);
    expect(t0.cy).toBeCloseTo(0.5, 6);
    const a = evaluateCamera(s, 1.23);
    const b = evaluateCamera(s, 1.23);
    expect(a).toEqual(b); // deterministic
    expect(Math.abs(a.cx - 0.5)).toBeLessThanOrEqual(0.02 / 2 + 1e-9);
    expect(Math.abs(a.cy - 0.5)).toBeLessThanOrEqual((0.02 / 2) * 0.75 + 1e-9);
    expect(a.zoom).toBe(2);
  });

  it('clamps times beyond the scene to the last shot', () => {
    const s = scene([shot({ move: 0, hold: 1, camera: { cx: 0.7, cy: 0.3, zoom: 1.5 } })]);
    expect(evaluateCamera(s, 50).cx).toBeCloseTo(0.7, 6);
  });
});
