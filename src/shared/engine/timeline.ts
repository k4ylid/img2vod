import type { Camera, HoldMotion, Project, Scene, Shot } from '../types';
import { DEFAULT_ARC_ZOOM_FACTOR } from '../types';
import { bezierEase, EASING_PRESETS } from './easing';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolates position linearly and zoom in log space so zoom speed feels uniform. */
export function lerpCamera(a: Camera, b: Camera, e: number): Camera {
  return {
    cx: lerp(a.cx, b.cx, e),
    cy: lerp(a.cy, b.cy, e),
    zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), e)),
  };
}

function arcLerpCamera(a: Camera, b: Camera, e: number, arcZoom: number | undefined): Camera {
  const lnA = Math.log(Math.max(a.zoom, 1e-6));
  const lnB = Math.log(Math.max(b.zoom, 1e-6));
  const mid = arcZoom ?? Math.min(a.zoom, b.zoom) * DEFAULT_ARC_ZOOM_FACTOR;
  // ln z(e) = lerp(lnA, lnB, e) - d * sin(pi * e); at e=0.5 zoom must equal `mid`.
  const d = Math.max(0, lerp(lnA, lnB, 0.5) - Math.log(Math.max(mid, 1e-6)));
  return {
    cx: lerp(a.cx, b.cx, e),
    cy: lerp(a.cy, b.cy, e),
    zoom: Math.exp(lerp(lnA, lnB, e) - d * Math.sin(Math.PI * e)),
  };
}

export function shotDuration(shot: Shot): number {
  return Math.max(0, shot.move) + Math.max(0, shot.hold);
}

export function sceneDuration(scene: Scene): number {
  return scene.shots.reduce((acc, s) => acc + shotDuration(s), 0);
}

export function projectDuration(project: Project): number {
  return project.scenes.reduce((acc, s) => acc + sceneDuration(s), 0);
}

export interface SceneLocation {
  scene: Scene;
  sceneIndex: number;
  /** Seconds into the scene (clamped to scene duration). */
  localT: number;
}

export function sceneAt(project: Project, t: number): SceneLocation | null {
  if (project.scenes.length === 0) {
    return null;
  }
  let cursor = 0;
  for (let i = 0; i < project.scenes.length; i++) {
    const dur = sceneDuration(project.scenes[i]);
    if (t < cursor + dur || i === project.scenes.length - 1) {
      return { scene: project.scenes[i], sceneIndex: i, localT: Math.min(Math.max(t - cursor, 0), dur) };
    }
    cursor += dur;
  }
  // Unreachable because the last scene always matches, but keeps TS happy.
  const last = project.scenes[project.scenes.length - 1];
  return { scene: last, sceneIndex: project.scenes.length - 1, localT: sceneDuration(last) };
}

/** Effective move length: the first shot of a scene and 'cut' moves do not travel. */
function effectiveMove(shot: Shot, index: number): number {
  if (index === 0 || shot.moveKind === 'cut') {
    return 0;
  }
  return Math.max(0, shot.move);
}

/**
 * Applies the rest-phase motion. `h` is normalized hold progress (0..1);
 * `holdT` is seconds into the hold (used for drift speed, which is
 * hold-length-independent). Deterministic: no Math.random.
 */
function applyHoldMotion(cam: Camera, motion: HoldMotion, h: number, holdT: number): Camera {
  switch (motion.type) {
    case 'microPush': {
      const e = bezierEase(EASING_PRESETS.easeInOut, Math.min(Math.max(h, 0), 1));
      return { ...cam, zoom: cam.zoom * (1 + motion.amount * e) };
    }
    case 'drift': {
      const s = motion.amount / Math.max(cam.zoom, 1e-6);
      return {
        cx: cam.cx + s * Math.sin(holdT * 1.3),
        cy: cam.cy + s * 0.75 * Math.sin(holdT * 0.9),
        zoom: cam.zoom,
      };
    }
    default:
      return cam;
  }
}

/** Evaluates the camera for a scene-local time (seconds into the scene). */
export function evaluateCamera(scene: Scene, localT: number): Camera {
  const shots = scene.shots;
  if (shots.length === 0) {
    return { cx: 0.5, cy: 0.5, zoom: 1 };
  }
  const t = Math.max(0, localT);
  let cursor = 0;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const dur = shotDuration(shot);
    const isLast = i === shots.length - 1;
    if (t < cursor + dur || isLast) {
      const inShot = Math.min(Math.max(t - cursor, 0), dur);
      const move = effectiveMove(shot, i);
      if (inShot < move) {
        const e = bezierEase(shot.easing, inShot / move);
        const prev = shots[i - 1].camera;
        if (shot.moveKind === 'arc') {
          return arcLerpCamera(prev, shot.camera, e, shot.arcZoom);
        }
        return lerpCamera(prev, shot.camera, e);
      }
      // Hold phase. For cut / first-shot moves the hold occupies the
      // combined move+hold window (camera is the target the whole time).
      const holdLen = dur - move;
      const holdT = inShot - move;
      const h = holdLen > 0 ? Math.min(holdT / holdLen, 1) : 1;
      return applyHoldMotion(shot.camera, shot.holdMotion, h, holdT);
    }
    cursor += dur;
  }
  return shots[shots.length - 1].camera;
}
