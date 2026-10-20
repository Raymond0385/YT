import { describe, expect, it } from 'vitest';
import { cropXAt, followLayout, ReframePlan } from './reframePreview';

const plan: ReframePlan = { mode: 'follow', crop_w: 606, crop_h: 1080, xs: [100, 120, 140, 160], rate: 10, src_w: 1920, src_h: 1080, start: 5 };

describe('preview of the face-following crop', () => {
  it('holds each step of the camera path like the render does', () => {
    expect(cropXAt(plan, 5)).toBe(100);
    expect(cropXAt(plan, 5.15)).toBe(120);
    expect(cropXAt(plan, 5.2)).toBe(140);
    expect(cropXAt(plan, 99)).toBe(160);       // after the end: the last position
    expect(cropXAt(plan, 1)).toBe(100);        // before the start: the first one
    expect(cropXAt({ ...plan, xs: [] }, 6)).toBe(0);
  });

  it('scales the video so the crop window fills the stage height', () => {
    const l = followLayout(plan, 5.25, 540);
    expect(l.height).toBe(540);
    expect(l.width).toBe(960);
    expect(l.left).toBe(-70);                  // x 140 at half scale
  });
});
