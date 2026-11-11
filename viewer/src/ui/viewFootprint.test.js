import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeViewFootprint } from './viewFootprint.js';

function cameraAt(position, target) {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  cam.up.set(0, 0, -1); // 바로 아래를 볼 때 위쪽 방향이 겹치지 않게 북(-z)을 화면 위로
  cam.position.set(...position);
  cam.lookAt(...target);
  cam.updateMatrixWorld();
  return cam;
}
const area = (p) => {
  // 신발끈 공식 (x, z 평면)
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
};

describe('computeViewFootprint', () => {
  it('바로 위에서 내려다보면 카메라 아래를 중심으로 한 정사각형이다', () => {
    const cam = cameraAt([100, 200, 50], [100, 0, 50]);
    const p = computeViewFootprint(cam, 0, 100000);
    expect(p).toHaveLength(4);
    const cx = p.reduce((s, q) => s + q.x, 0) / 4;
    const cz = p.reduce((s, q) => s + q.z, 0) / 4;
    expect(cx).toBeCloseTo(100, 3);
    expect(cz).toBeCloseTo(50, 3);
    // 시야각 60도, 높이 200 -> 한 변 = 2*200*tan(30도)
    const side = 2 * 200 * Math.tan(Math.PI / 6);
    expect(area(p)).toBeCloseTo(side * side, 1);
  });

  it('가까이 갈수록 사각형이 작아진다 (확대 정도가 보인다)', () => {
    const far = computeViewFootprint(cameraAt([0, 400, 0], [0, 0, 0]), 0, 1e6);
    const near = computeViewFootprint(cameraAt([0, 100, 0], [0, 0, 0]), 0, 1e6);
    expect(area(far) / area(near)).toBeCloseTo(16, 1);
  });

  it('기울여서 하늘이 보여도 maxDistance에서 끊어 끝없이 늘어나지 않는다', () => {
    const cam = cameraAt([0, 50, 0], [0, 40, -100]); // 거의 수평으로 봄
    const p = computeViewFootprint(cam, 0, 500);
    for (const q of p) {
      expect(Number.isFinite(q.x) && Number.isFinite(q.z)).toBe(true);
      expect(Math.hypot(q.x, q.z)).toBeLessThanOrEqual(500 + 1e-6);
    }
  });

  it('카메라가 바닥 아래에 있어도 오류 없이 끊은 거리로 돌려준다', () => {
    const p = computeViewFootprint(cameraAt([0, -10, 0], [0, -20, -50]), 0, 300);
    expect(p).toHaveLength(4);
    for (const q of p) expect(Math.hypot(q.x, q.z)).toBeLessThanOrEqual(300 + 1e-6);
  });
});
