/** Number of video frames covering `duration` seconds at `fps`. */
export function exportFrameCount(duration: number, fps: number): number {
  return Math.max(1, Math.round(duration * fps));
}

/** Timestamp (seconds) of frame index `i` at `fps`. */
export function frameTime(i: number, fps: number): number {
  return i / fps;
}
