import { describe, it, expect } from 'vitest';
import { computePanClampDelta } from './panClamp.js';

describe('computePanClampDelta', () => {
  it('returns a zero delta when the target is within maxDistance of the center', () => {
    const result = computePanClampDelta({
      targetX: 5,
      targetZ: 5,
      centerX: 0,
      centerZ: 0,
      maxDistance: 100,
    });
    expect(result).toEqual({ deltaX: 0, deltaZ: 0 });
  });

  it('returns a zero delta exactly at the boundary (dist === maxDistance)', () => {
    const result = computePanClampDelta({
      targetX: 10,
      targetZ: 0,
      centerX: 0,
      centerZ: 0,
      maxDistance: 10,
    });
    expect(result).toEqual({ deltaX: 0, deltaZ: 0 });
  });

  it('pulls the target back so its distance from center equals maxDistance, preserving direction', () => {
    // 중심에서 (30,40) 방향(거리 50)에 있는데 최대 20까지만 허용 -- 같은 방향으로 20만큼만 남아야 함.
    const result = computePanClampDelta({
      targetX: 30,
      targetZ: 40,
      centerX: 0,
      centerZ: 0,
      maxDistance: 20,
    });
    const clampedX = 30 + result.deltaX;
    const clampedZ = 40 + result.deltaZ;
    expect(Math.hypot(clampedX, clampedZ)).toBeCloseTo(20, 6);
    // 방향(각도) 보존 확인: clamped 벡터가 원래 벡터의 양의 배수여야 한다.
    expect(clampedX / 30).toBeCloseTo(clampedZ / 40, 6);
  });

  it('works with a non-origin center', () => {
    const result = computePanClampDelta({
      targetX: 110,
      targetZ: 210,
      centerX: 100,
      centerZ: 200,
      maxDistance: 5,
    });
    const clampedX = 110 + result.deltaX;
    const clampedZ = 210 + result.deltaZ;
    expect(Math.hypot(clampedX - 100, clampedZ - 200)).toBeCloseTo(5, 6);
  });
});
