import { describe, expect, it } from 'vitest';
// @ts-ignore: plain JS config, no type declarations
import tailwindConfig from '../../tailwind.config.js';
import specs from '../data/animations.json';

type Keyframe = { at: number; scaleX: number; scaleY: number; opacity: number };
type Spec = { durationMs: number; origin: string; keyframes: Keyframe[] };
const words = Object.entries(specs).filter(([, v]) => v && typeof v === 'object' && 'keyframes' in (v as object)) as [string, Spec][];

describe('word animations', () => {
  it('the data file describes pop, bounce and fade with sane keyframes', () => {
    expect(words.map(([n]) => n).sort()).toEqual(['bounce', 'fade', 'pop']);
    for (const [name, spec] of words) {
      expect(spec.durationMs, name).toBeGreaterThan(0);
      expect(spec.keyframes[0].at, name).toBe(0);
      expect(spec.keyframes[spec.keyframes.length - 1].at, name).toBe(1);
      const ats = spec.keyframes.map((k) => k.at);
      expect([...ats].sort((a, b) => a - b), name).toEqual(ats);
      for (const k of spec.keyframes) {
        expect(k.opacity).toBeGreaterThanOrEqual(0);
        expect(k.opacity).toBeLessThanOrEqual(1);
        expect(k.scaleX).toBeGreaterThan(0);
        expect(k.scaleY).toBeGreaterThan(0);
      }
    }
  });

  it('the preview CSS is generated from that file (same scale and opacity at every keyframe)', () => {
    const ext = tailwindConfig.theme.extend;
    for (const [name, spec] of words) {
      const css = ext.keyframes[name];
      expect(css, name).toBeTruthy();
      expect(Object.keys(css)).toHaveLength(spec.keyframes.length);
      for (const k of spec.keyframes) {
        const frame = css[`${Math.round(k.at * 1000) / 10}%`];
        expect(frame, `${name} @${k.at}`).toBeTruthy();
        expect(frame.transform).toBe(`scale(${k.scaleX}, ${k.scaleY})`);
        expect(frame.opacity).toBe(String(k.opacity));
      }
      // same duration, linear like libass
      expect(ext.animation[name]).toBe(`${name} ${spec.durationMs}ms linear forwards`);
    }
  });

  it('keeps the unrelated glow animation', () => {
    expect(tailwindConfig.theme.extend.animation.glow).toContain('glow');
  });
});
