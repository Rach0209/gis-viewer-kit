import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeMinimapExtent } from './minimapExtent.js';

const box = (x0, z0, x1, z1) => new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 10, z1));
const square = (cx, cz, h) => [
  { x: cx - h, z: cz - h },
  { x: cx + h, z: cz - h },
  { x: cx + h, z: cz + h },
  { x: cx - h, z: cz + h },
];

describe('computeMinimapExtent', () => {
  it('보이는 영역이 데이터 안에 있으면 데이터 범위 그대로', () => {
    const b = box(0, 0, 100, 100);
    const e = computeMinimapExtent(b, square(50, 50, 30));
    expect(e.min.x).toBe(0);
    expect(e.max.x).toBe(100);
    expect(e).not.toBe(b); // 복사본
  });

  it('보이는 영역이 데이터보다 넓으면 중심은 그대로 두고 정사각형으로 넓힌다', () => {
    const b = box(0, 0, 100, 60);
    const e = computeMinimapExtent(b, square(50, 30, 200));
    expect((e.min.x + e.max.x) / 2).toBeCloseTo(50, 6);
    expect((e.min.z + e.max.z) / 2).toBeCloseTo(30, 6);
    expect(e.max.x - e.min.x).toBeCloseTo(e.max.z - e.min.z, 6);
    // 보이는 영역이 다 들어간다 (최대 단계 안에서)
    expect(e.max.x).toBeGreaterThanOrEqual(250 - 1e-6);
    expect(e.min.y).toBe(0);
    expect(e.max.y).toBe(10);
  });

  it('범위는 단계적으로만 변한다: 조금씩 달라지는 입력에는 같은 범위', () => {
    const b = box(0, 0, 100, 100);
    const a = computeMinimapExtent(b, square(50, 50, 120));
    const c = computeMinimapExtent(b, square(50, 50, 125));
    expect(a.max.x - a.min.x).toBeCloseTo(c.max.x - c.min.x, 6);
    const bigger = computeMinimapExtent(b, square(50, 50, 400));
    expect(bigger.max.x - bigger.min.x).toBeGreaterThan(a.max.x - a.min.x);
  });

  it('너무 멀리는 넓히지 않는다 (maxLevels)', () => {
    const b = box(0, 0, 100, 100);
    const e = computeMinimapExtent(b, square(50, 50, 1e9), { step: 2, maxLevels: 3 });
    expect(e.max.x - e.min.x).toBeCloseTo(100 * 8, 6);
  });

  it('보이는 영역이 없거나 데이터가 비었으면 그대로', () => {
    const b = box(0, 0, 100, 100);
    expect(computeMinimapExtent(b, null).max.x).toBe(100);
    expect(computeMinimapExtent(b, []).max.x).toBe(100);
    expect(computeMinimapExtent(new THREE.Box3(), square(0, 0, 5)).isEmpty()).toBe(true);
  });
});
