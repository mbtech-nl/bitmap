import { describe, expect, it } from 'vitest';

import { applyGamma, autoLevels, resolveWeights } from '../pipeline.js';

describe('resolveWeights', () => {
  it('returns BT.709 for "bt709"', () => {
    expect(resolveWeights('bt709')).toEqual([0.2126, 0.7152, 0.0722]);
  });

  it('returns BT.601 for "bt601"', () => {
    expect(resolveWeights('bt601')).toEqual([0.299, 0.587, 0.114]);
  });

  it('passes through a tuple summing to 1', () => {
    const weights: readonly [number, number, number] = [0.5, 0.3, 0.2];
    expect(resolveWeights(weights)).toBe(weights);
  });

  it('throws if a tuple does not sum to ~1', () => {
    expect(() => resolveWeights([0.5, 0.3, 0.1])).toThrow(RangeError);
    expect(() => resolveWeights([0.4, 0.4, 0.4])).toThrow(RangeError);
  });

  it('accepts tuples within ±1e-6 of summing to 1', () => {
    expect(() => resolveWeights([0.4, 0.4, 0.2 - 5e-7])).not.toThrow();
    expect(() => resolveWeights([0.4, 0.4, 0.2 + 5e-7])).not.toThrow();
  });

  it('throws if any tuple component is negative', () => {
    expect(() => resolveWeights([1.5, -0.3, -0.2])).toThrow(RangeError);
    expect(() => resolveWeights([1, 0, 0])).not.toThrow();
    expect(() => resolveWeights([-0, 0.5, 0.5])).not.toThrow();
  });
});

describe('autoLevels', () => {
  it('flat input is unchanged', () => {
    const input = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    const out = autoLevels(input);
    expect(Array.from(out)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('input with min=0.2 max=0.8 is stretched to span 0..1', () => {
    const input = new Float32Array([0.2, 0.5, 0.8]);
    autoLevels(input);
    expect(input[0]).toBeCloseTo(0, 5);
    expect(input[1]).toBeCloseTo(0.5, 5);
    expect(input[2]).toBeCloseTo(1, 5);
  });

  it('idempotent: running twice produces the same result as running once', () => {
    const input = new Float32Array([0.2, 0.5, 0.8]);
    autoLevels(input);
    const once = Array.from(input);
    autoLevels(input);
    expect(Array.from(input)).toEqual(once);
  });

  it('handles a single-pixel array', () => {
    const input = new Float32Array([0.42]);
    const before = input[0]!;
    expect(() => autoLevels(input)).not.toThrow();
    expect(input[0]).toBe(before);
  });

  it('handles an empty array without throwing', () => {
    const input = new Float32Array(0);
    expect(() => autoLevels(input)).not.toThrow();
    expect(input.length).toBe(0);
  });

  it('mutates input in place and returns the same reference', () => {
    const input = new Float32Array([0.2, 0.5, 0.8]);
    const out = autoLevels(input);
    expect(out).toBe(input);
  });
});

describe('applyGamma', () => {
  it('gamma === 1 is a no-op', () => {
    const input = new Float32Array([0, 0.25, 0.5, 0.75, 1]);
    const original = Array.from(input);
    applyGamma(input, 1);
    expect(Array.from(input)).toEqual(original);
  });

  it('gamma === 2 squares each value', () => {
    const input = new Float32Array([0, 0.25, 0.5, 0.75, 1]);
    applyGamma(input, 2);
    expect(input[0]).toBeCloseTo(0, 6);
    expect(input[1]).toBeCloseTo(0.0625, 6);
    expect(input[2]).toBeCloseTo(0.25, 6);
    expect(input[3]).toBeCloseTo(0.5625, 6);
    expect(input[4]).toBeCloseTo(1, 6);
  });

  it('gamma === 0.5 takes the square root of each value', () => {
    const input = new Float32Array([0, 0.25, 1]);
    applyGamma(input, 0.5);
    expect(input[0]).toBeCloseTo(0, 6);
    expect(input[1]).toBeCloseTo(0.5, 6);
    expect(input[2]).toBeCloseTo(1, 6);
  });

  it('throws for gamma <= 0', () => {
    expect(() => applyGamma(new Float32Array([0.5]), 0)).toThrow(RangeError);
    expect(() => applyGamma(new Float32Array([0.5]), -1)).toThrow(RangeError);
  });

  it('throws for NaN gamma', () => {
    expect(() => applyGamma(new Float32Array([0.5]), Number.NaN)).toThrow(RangeError);
  });

  it('throws for Infinity gamma', () => {
    expect(() => applyGamma(new Float32Array([0.5]), Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('throws for -Infinity gamma', () => {
    expect(() => applyGamma(new Float32Array([0.5]), Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it('clamps negative input to 0 (no NaN from pow)', () => {
    const input = new Float32Array([-0.1, 0, 0.5]);
    applyGamma(input, 2);
    expect(input[0]).toBe(0);
    expect(Number.isNaN(input[1])).toBe(false);
    expect(Number.isNaN(input[2])).toBe(false);
  });

  it('mutates input in place', () => {
    const input = new Float32Array([0.5]);
    const out = applyGamma(input, 2);
    expect(out).toBe(input);
  });
});
