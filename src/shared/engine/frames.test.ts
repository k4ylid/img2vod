import { describe, expect, it } from 'vitest';
import { exportFrameCount, frameTime } from './frames';

describe('exportFrameCount', () => {
  it('4s @ 30fps -> 120 frames', () => {
    expect(exportFrameCount(4, 30)).toBe(120);
  });

  it('2.5s @ 24fps -> 60 frames', () => {
    expect(exportFrameCount(2.5, 24)).toBe(60);
  });

  it('0s -> at least 1 frame', () => {
    expect(exportFrameCount(0, 30)).toBe(1);
  });
});

describe('frameTime', () => {
  it('frame 30 @ 30fps -> 1s', () => {
    expect(frameTime(30, 30)).toBe(1);
  });
});
