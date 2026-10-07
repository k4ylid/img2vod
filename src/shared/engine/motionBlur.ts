import type { Project } from '../types';
import { effectiveMove, sceneAt, sceneDuration, shotDuration } from './timeline';

export const MOTION_BLUR_SAMPLES = 8;
export const MOTION_BLUR_SHUTTER = 0.5; // fraction of a frame interval (180°)

/**
 * Times to render and average for the frame at time t. Returns [t] when no
 * blur applies — blur only happens during a flagged shot's move phase
 * (first-shot and cut moves never travel, so they never blur either).
 * Samples run forward from t (sample 0 is exactly t) and are clamped to just
 * before the scene end so a blurred frame never blends into the next scene.
 * Deterministic: no Math.random.
 */
export function motionBlurSampleTimes(project: Project, t: number, fps: number): number[] {
  const loc = sceneAt(project, t);
  if (!loc) {
    return [t];
  }
  const { scene, localT } = loc;

  // Shot containing localT: same rule as evaluateCamera (first shot whose
  // [cursor, cursor+shotDuration) contains it, last shot otherwise).
  let cursor = 0;
  let index = scene.shots.length - 1;
  let inShot = 0;
  for (let i = 0; i < scene.shots.length; i++) {
    const dur = shotDuration(scene.shots[i]);
    if (localT < cursor + dur || i === scene.shots.length - 1) {
      index = i;
      inShot = Math.min(Math.max(localT - cursor, 0), dur);
      break;
    }
    cursor += dur;
  }
  const shot = scene.shots[index];
  if (!shot || !shot.motionBlur || inShot >= effectiveMove(shot, index)) {
    return [t];
  }

  let sceneStart = 0;
  for (let i = 0; i < loc.sceneIndex; i++) {
    sceneStart += sceneDuration(project.scenes[i]);
  }
  const maxT = sceneStart + sceneDuration(scene) - 1e-6;
  const span = MOTION_BLUR_SHUTTER / fps;
  const times: number[] = [];
  for (let k = 0; k < MOTION_BLUR_SAMPLES; k++) {
    times.push(Math.min(t + (k / MOTION_BLUR_SAMPLES) * span, maxT));
  }
  return times;
}
