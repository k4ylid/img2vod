import type { Easing } from '../types';

// CSS cubic-bezier solver: Newton-Raphson with subdivision fallback,
// matching the algorithm used by browsers (same structure as bezier-easing).

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS = 10;
const SPLINE_TABLE_SIZE = 11;
const SAMPLE_STEP_SIZE = 1.0 / (SPLINE_TABLE_SIZE - 1.0);

const float32ArraySupported = typeof Float32Array === 'function';

function A(a1: number, a2: number): number {
  return 1.0 - 3.0 * a2 + 3.0 * a1;
}

function B(a1: number, a2: number): number {
  return 3.0 * a2 - 6.0 * a1;
}

function C(a1: number): number {
  return 3.0 * a1;
}

function calcBezier(t: number, a1: number, a2: number): number {
  return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
}

function getSlope(t: number, a1: number, a2: number): number {
  return 3.0 * A(a1, a2) * t * t + 2.0 * B(a1, a2) * t + C(a1);
}

function binarySubdivide(x: number, a: number, b: number, x1: number, x2: number): number {
  let currentX = 0;
  let currentT = 0;
  let i = 0;
  let lo = a;
  let hi = b;
  do {
    currentT = lo + (hi - lo) / 2.0;
    currentX = calcBezier(currentT, x1, x2) - x;
    if (currentX > 0.0) {
      hi = currentT;
    } else {
      lo = currentT;
    }
  } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
  return currentT;
}

function newtonRaphsonIterate(x: number, guessT: number, x1: number, x2: number): number {
  let t = guessT;
  for (let i = 0; i < NEWTON_ITERATIONS; ++i) {
    const currentSlope = getSlope(t, x1, x2);
    if (currentSlope === 0.0) {
      return t;
    }
    const currentX = calcBezier(t, x1, x2) - x;
    t -= currentX / currentSlope;
  }
  return t;
}

/**
 * Returns a function that maps input progress x in [0,1] to eased output y,
 * following CSS cubic-bezier(x1, y1, x2, y2) semantics.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  if (!(0 <= x1 && x1 <= 1 && 0 <= x2 && x2 <= 1)) {
    throw new Error(`bezier x values must be in [0, 1], got ${x1}, ${x2}`);
  }
  if (x1 === y1 && x2 === y2) {
    return (x) => x;
  }

  // Precompute sample table for the x curve.
  const sampleValues = float32ArraySupported
    ? new Float32Array(SPLINE_TABLE_SIZE)
    : new Array<number>(SPLINE_TABLE_SIZE);
  for (let i = 0; i < SPLINE_TABLE_SIZE; ++i) {
    sampleValues[i] = calcBezier(i * SAMPLE_STEP_SIZE, x1, x2);
  }

  function getTForX(x: number): number {
    let intervalStart = 0.0;
    let currentSample = 1;
    const lastSample = SPLINE_TABLE_SIZE - 1;

    for (; currentSample !== lastSample && sampleValues[currentSample] <= x; ++currentSample) {
      intervalStart += SAMPLE_STEP_SIZE;
    }
    --currentSample;

    const dist =
      (x - sampleValues[currentSample]) /
      (sampleValues[currentSample + 1] - sampleValues[currentSample]);
    const guessForT = intervalStart + dist * SAMPLE_STEP_SIZE;

    const initialSlope = getSlope(guessForT, x1, x2);
    if (initialSlope >= NEWTON_MIN_SLOPE) {
      return newtonRaphsonIterate(x, guessForT, x1, x2);
    }
    if (initialSlope === 0.0) {
      return guessForT;
    }
    return binarySubdivide(x, intervalStart, intervalStart + SAMPLE_STEP_SIZE, x1, x2);
  }

  return (x: number): number => {
    if (x === 0 || x === 1) {
      return x;
    }
    return calcBezier(getTForX(x), y1, y2);
  };
}

export function bezierEase(e: Easing, t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return cubicBezier(e.x1, e.y1, e.x2, e.y2)(clamped);
}

const preset = (x1: number, y1: number, x2: number, y2: number): Easing => ({
  type: 'bezier',
  x1,
  y1,
  x2,
  y2,
});

export const EASING_PRESETS = {
  linear: preset(0, 0, 1, 1),
  ease: preset(0.25, 0.1, 0.25, 1),
  easeIn: preset(0.42, 0, 1, 1),
  easeOut: preset(0, 0, 0.58, 1),
  easeInOut: preset(0.42, 0, 0.58, 1),
  smooth: preset(0.65, 0, 0.35, 1),
  gentleOvershoot: preset(0.34, 1.2, 0.64, 1),
} as const;

export type EasingPresetName = keyof typeof EASING_PRESETS;

export function isPreset(e: Easing, name: EasingPresetName): boolean {
  const p = EASING_PRESETS[name];
  return e.x1 === p.x1 && e.y1 === p.y1 && e.x2 === p.x2 && e.y2 === p.y2;
}
