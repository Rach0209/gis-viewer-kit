import { describe, it, expect } from 'vitest';
import { computeApparentRadiusPx, updateMarkerVisibilityByScreenSize } from './markerScreenSize.js';

describe('computeApparentRadiusPx', () => {
  it('halves the apparent radius when distance doubles', () => {
    const base = computeApparentRadiusPx({
      worldRadius: 15,
      distance: 100,
      cameraFovDeg: 60,
      viewportHeightPx: 720,
    });
    const doubled = computeApparentRadiusPx({
      worldRadius: 15,
      distance: 200,
      cameraFovDeg: 60,
      viewportHeightPx: 720,
    });

    expect(doubled).toBeCloseTo(base / 2, 5);
  });

  it('scales linearly with world radius', () => {
    const small = computeApparentRadiusPx({
      worldRadius: 10,
      distance: 500,
      cameraFovDeg: 60,
      viewportHeightPx: 720,
    });
    const large = computeApparentRadiusPx({
      worldRadius: 20,
      distance: 500,
      cameraFovDeg: 60,
      viewportHeightPx: 720,
    });

    expect(large).toBeCloseTo(small * 2, 5);
  });

  it('returns Infinity when the camera is at or past the marker (distance <= 0)', () => {
    expect(
      computeApparentRadiusPx({ worldRadius: 15, distance: 0, cameraFovDeg: 60, viewportHeightPx: 720 })
    ).toBe(Infinity);
  });
});

describe('updateMarkerVisibilityByScreenSize', () => {
  // three.js 없이도 테스트할 수 있도록, 이 함수가 실제로 쓰는 속성(camera.position.distanceTo,
  // mesh.position, mesh.visible)만 갖춘 최소한의 가짜 mesh/camera를 만든다.
  function fakeMesh(x) {
    return { position: { x }, visible: true };
  }
  function fakeCamera(fov) {
    return { position: { x: 0, distanceTo: (p) => Math.abs(0 - p.x) }, fov };
  }

  it('hides meshes whose apparent radius falls below the threshold and keeps the rest visible', () => {
    const near = fakeMesh(50); // 가까움 -> 화면에 크게 보임 -> 보여야 함
    const far = fakeMesh(50000); // 아주 멂 -> 화면에서 사라져야 함
    const camera = fakeCamera(60);

    updateMarkerVisibilityByScreenSize([near, far], 15, camera, 720, 4);

    expect(near.visible).toBe(true);
    expect(far.visible).toBe(false);
  });
});
