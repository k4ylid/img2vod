import { describe, expect, it } from 'vitest';
import { bezierEase, cubicBezier, EASING_PRESETS } from './easing';

const EPS = 1e-6;

describe('cubicBezier', () => {
  it('hits the endpoints for every preset', () => {
    for (const e of Object.values(EASING_PRESETS)) {
      expect(bezierEase(e, 0)).toBeCloseTo(0, 5);
      expect(bezierEase(e, 1)).toBeCloseTo(1, 5);
    }
  });

  it('linear preset is the identity', () => {
    const lin = cubicBezier(0, 0, 1, 1);
    for (const t of [0.13, 0.37, 0.5, 0.83]) {
      expect(lin(t)).toBeCloseTo(t, EPS);
    }
  });

  it('easeInOut approximates CSS: slow at ends, fast in the middle', () => {
    const e = EASING_PRESETS.easeInOut;
    // Symmetric around 0.5.
    expect(bezierEase(e, 0.5)).toBeCloseTo(0.5, 3);
    expect(bezierEase(e, 0.1)).toBeLessThan(0.1);
    expect(bezierEase(e, 0.9)).toBeGreaterThan(0.9);
  });

  it('easeOut decelerates: above linear for t in (0,1)', () => {
    const e = EASING_PRESETS.easeOut;
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expect(bezierEase(e, t)).toBeGreaterThan(t);
      expect(bezierEase(e, t)).toBeLessThan(1);
    }
  });

  it('easeIn accelerates: below linear for t in (0,1)', () => {
    const e = EASING_PRESETS.easeIn;
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expect(bezierEase(e, t)).toBeLessThan(t);
      expect(bezierEase(e, t)).toBeGreaterThan(0);
    }
  });

  it('easeInOut is monotonically increasing in x', () => {
    const e = EASING_PRESETS.easeInOut;
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = bezierEase(e, i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('gentleOvershoot exceeds 1 somewhere in the middle', () => {
    const e = EASING_PRESETS.gentleOvershoot;
    let max = 0;
    for (let i = 0; i <= 200; i++) {
      max = Math.max(max, bezierEase(e, i / 200));
    }
    expect(max).toBeGreaterThan(1);
    expect(bezierEase(e, 1)).toBeCloseTo(1, 5);
  });

  it('clamps t outside [0,1]', () => {
    const e = EASING_PRESETS.easeInOut;
    expect(bezierEase(e, -0.5)).toBeCloseTo(0, 5);
    expect(bezierEase(e, 1.5)).toBeCloseTo(1, 5);
  });

  it('rejects invalid x control points', () => {
    expect(() => cubicBezier(-0.1, 0, 0.5, 1)).toThrow();
    expect(() => cubicBezier(0, 0, 1.2, 1)).toThrow();
  });
});
