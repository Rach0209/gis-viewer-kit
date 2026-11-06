import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeMinimapProjection, SIZE } from './Minimap.js';

describe('computeMinimapProjection', () => {
  it('데이터 범위의 중심을 투영 중심으로 쓴다', () => {
    const box = new THREE.Box3(new THREE.Vector3(-100, 0, -50), new THREE.Vector3(300, 10, 150));
    const p = computeMinimapProjection(box, SIZE);
    expect(p.centerX).toBe(100);
    expect(p.centerZ).toBe(50);
  });

  it('긴 변이 캔버스에 85%로 들어오도록 스케일을 정한다', () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(400, 10, 100));
    const p = computeMinimapProjection(box, 150);
    expect(p.scale).toBeCloseTo((150 / 400) * 0.85, 10);
    // 가로 400 -> 화면에서 150*0.85 = 127.5px
    expect(400 * p.scale).toBeCloseTo(127.5, 6);
  });

  it('크기가 0인 범위도 0으로 나누지 않는다', () => {
    const box = new THREE.Box3(new THREE.Vector3(5, 0, 5), new THREE.Vector3(5, 0, 5));
    const p = computeMinimapProjection(box, 150);
    expect(Number.isFinite(p.scale)).toBe(true);
    expect(p.scale).toBeGreaterThan(0);
  });
});
