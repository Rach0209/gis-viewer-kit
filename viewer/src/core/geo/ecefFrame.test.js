import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Ellipsoid } from '3d-tiles-renderer';
import { computeEcefToLocalMatrix } from './ecefFrame.js';

const WGS84 = new Ellipsoid(6378137, 6378137, 6356752.314245);
const ORIGIN = { lon: 126.9784, lat: 37.5665, alt: 0 };

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** origin(도 단위)에서 lat/lon/height만큼 떨어진 지점의 ECEF 위치. */
function ecefAt(lat, lon, height) {
  return WGS84.getCartographicToPosition(toRad(lat), toRad(lon), height, new THREE.Vector3());
}

describe('computeEcefToLocalMatrix', () => {
  it('maps the ECEF position of the origin itself to local (0,0,0)', () => {
    const matrix = computeEcefToLocalMatrix(WGS84, ORIGIN);
    const local = ecefAt(ORIGIN.lat, ORIGIN.lon, ORIGIN.alt).applyMatrix4(matrix);
    expect(local.x).toBeCloseTo(0, 6);
    expect(local.y).toBeCloseTo(0, 6);
    expect(local.z).toBeCloseTo(0, 6);
  });

  it('maps a point directly above the origin to local +y (our up axis), with ~zero x/z', () => {
    const matrix = computeEcefToLocalMatrix(WGS84, ORIGIN);
    const local = ecefAt(ORIGIN.lat, ORIGIN.lon, 50).applyMatrix4(matrix);
    expect(local.y).toBeCloseTo(50, 3);
    expect(Math.abs(local.x)).toBeLessThan(1e-6);
    expect(Math.abs(local.z)).toBeLessThan(1e-6);
  });

  it('maps a point east of the origin to local +x, matching crs.js x=east convention', () => {
    const matrix = computeEcefToLocalMatrix(WGS84, ORIGIN);
    const local = ecefAt(ORIGIN.lat, ORIGIN.lon + 0.001, ORIGIN.alt).applyMatrix4(matrix);
    expect(local.x).toBeGreaterThan(0);
    expect(Math.abs(local.z)).toBeLessThan(50);
  });

  it('maps a point north of the origin to local -z, matching crs.js z=-north convention', () => {
    // crs.js와 같은 축 규칙(z=-북)을 쓰는지 확인 -- 이 부호를 놓치면 3D Tiles
    // 레이어와 래스터 레이어가 남북이 뒤집힌 채로 나란히 놓이게 된다.
    const matrix = computeEcefToLocalMatrix(WGS84, ORIGIN);
    const local = ecefAt(ORIGIN.lat + 0.001, ORIGIN.lon, ORIGIN.alt).applyMatrix4(matrix);
    expect(local.z).toBeLessThan(0);
    expect(Math.abs(local.x)).toBeLessThan(50);
  });
});
