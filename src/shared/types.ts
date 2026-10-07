export type Resolution = '720p' | '1080p'; // 1280x720 / 1920x1080
export type Fps = 24 | 25 | 30 | 60;

export interface ProjectSettings {
  resolution: Resolution;
  fps: Fps;
}

export interface ImageAsset {
  id: string;
  path: string;
  name: string;
  width: number;
  height: number;
}

/**
 * cx, cy = view center in normalized image coords (0..1).
 * zoom 1 = whole image fits inside the frame (contain).
 */
export interface Camera {
  cx: number;
  cy: number;
  zoom: number;
}

/** CSS cubic-bezier semantics; y may exceed [0,1] for overshoot. */
export interface Easing {
  type: 'bezier';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** arc = "pull back -> travel -> push in" */
export type MoveKind = 'cut' | 'direct' | 'arc';

export type HoldMotion =
  | { type: 'none' }
  | { type: 'microPush'; amount: number } // e.g. 0.05 = +5% zoom over hold
  | { type: 'drift'; amount: number }; // fraction of view, e.g. 0.01

export interface Shot {
  id: string;
  name: string;
  move: number; // seconds: transition from previous shot's camera to this camera
  hold: number; // seconds: rest on this camera
  camera: Camera;
  moveKind: MoveKind;
  arcZoom?: number; // zoom at midpoint of an arc move; default = min(prevZoom, zoom) * 0.87
  easing: Easing;
  holdMotion: HoldMotion;
  motionBlur: boolean; // export-only: averages sub-frame samples during moves
}

export interface Scene {
  id: string;
  imageId: string;
  shots: Shot[];
}

export interface Project {
  version: 1;
  name: string;
  settings: ProjectSettings;
  images: ImageAsset[];
  scenes: Scene[];
  audio?: { path: string; includeInExport: boolean };
  markers: number[];
}

export const RESOLUTION_DIMS: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export const FPS_OPTIONS: readonly Fps[] = [24, 25, 30, 60];

export const DEFAULT_ARC_ZOOM_FACTOR = 0.87;
