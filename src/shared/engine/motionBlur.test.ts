import { describe, expect, it } from 'vitest';
import type { Camera, Easing, Project, Scene, Shot } from '../types';
import { motionBlurSampleTimes, MOTION_BLUR_SAMPLES, MOTION_BLUR_SHUTTER } from './motionBlur';
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

const CAM_A: Camera = { cx: 0.5, cy: 0.5, zoom: 1 };
const CAM_B: Camera = { cx: 0.8, cy: 0.3, zoom: 2 };

describe('motionBlurSampleTimes', () => {
  it('returns [t] when the flag is off', () => {
    const p = project([
      scene([
        shot({ move: 0, hold: 1, camera: CAM_A }),
        shot({ move: 1, hold: 1, camera: CAM_B, motionBlur: false }),
      ]),
    ]);
    expect(motionBlurSampleTimes(p, 1.5, 30)).toEqual([1.5]);
  });

  it('returns [t] during the hold phase even with the flag on', () => {
    const p = project([
      scene([
        shot({ move: 0, hold: 1, camera: CAM_A }),
        shot({ move: 1, hold: 1, camera: CAM_B, motionBlur: true }),
      ]),
    ]);
    expect(motionBlurSampleTimes(p, 2.5, 30)).toEqual([2.5]); // move [1,2), hold [2,3)
  });

  it('returns [t] for the first shot of a scene (its move never travels)', () => {
    const p = project([
      scene([
        shot({ move: 1, hold: 1, camera: CAM_A, motionBlur: true }),
        shot({ move: 1, hold: 1, camera: CAM_B }),
      ]),
    ]);
    expect(motionBlurSampleTimes(p, 0.5, 30)).toEqual([0.5]);
  });

  it("returns [t] for 'cut' moves", () => {
    const p = project([
      scene([
        shot({ move: 0, hold: 1, camera: CAM_A }),
        shot({ move: 1, hold: 1, camera: CAM_B, moveKind: 'cut', motionBlur: true }),
      ]),
    ]);
    expect(motionBlurSampleTimes(p, 1.5, 30)).toEqual([1.5]);
  });

  it('returns 8 forward samples inside a flagged move at 30fps', () => {
    const p = project([
      scene([
        shot({ move: 0, hold: 1, camera: CAM_A }),
        shot({ move: 1, hold: 1, camera: CAM_B, motionBlur: true }),
      ]),
    ]);
    const t = 1.4; // mid-move of shot 2: move window is [1,2)
    const times = motionBlurSampleTimes(p, t, 30);
    expect(times).toHaveLength(MOTION_BLUR_SAMPLES);
    expect(times[0]).toBe(t);
    for (let k = 1; k < times.length; k++) {
      expect(times[k]).toBeGreaterThan(times[k - 1]);
    }
    expect(times[times.length - 1]).toBeCloseTo(t + ((MOTION_BLUR_SAMPLES - 1) / MOTION_BLUR_SAMPLES) * (MOTION_BLUR_SHUTTER / 30), 12);
  });

  it('clamps samples at the scene end when a move ends on the boundary (hold 0)', () => {
    const p = project([
      scene(
        [
          shot({ move: 0, hold: 1, camera: CAM_A }),
          shot({ move: 1, hold: 0, camera: CAM_B, motionBlur: true }),
        ],
        'a',
      ),
      scene([shot({ move: 0, hold: 2, camera: CAM_A })], 'b', 'img2'),
    ]);
    // Scene 'a' occupies [0,2); shot 2's move is [1,2). At t=1.995 the forward
    // samples would cross into scene 'b' without clamping.
    const times = motionBlurSampleTimes(p, 1.995, 30);
    expect(times).toHaveLength(MOTION_BLUR_SAMPLES);
    for (const ts of times) {
      expect(ts).toBeLessThanOrEqual(2 - 1e-6 + 1e-12);
      expect(ts).toBeLessThan(2); // never inside the next scene
    }
    expect(times[times.length - 1]).toBeCloseTo(2 - 1e-6, 8);
  });

  it('returns [t] for a project with no scenes', () => {
    expect(motionBlurSampleTimes(project([]), 1.2, 30)).toEqual([1.2]);
  });
});
