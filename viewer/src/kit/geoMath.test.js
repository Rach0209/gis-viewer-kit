import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer';
import { createLocalToGeodetic, createGeodeticToLocal } from './geoMath.js';
import { computeEcefToLocalMatrix } from '../core/geo/ecefFrame.js';

const ORIGIN = { lon: 126.978, lat: 37.5665, alt: 0 };

describe('createLocalToGeodetic', () => {
  const toGeo = createLocalToGeodetic(ORIGIN);

  it('로컬 원점은 기준 원점의 경위도로 돌아간다', () => {
    const g = toGeo(0, 0, 0);
    expect(g.lon).toBeCloseTo(ORIGIN.lon, 8);
    expect(g.lat).toBeCloseTo(ORIGIN.lat, 8);
    expect(g.alt).toBeCloseTo(0, 3);
  });

  it('+y는 고도 증가', () => {
    expect(toGeo(0, 50, 0).alt).toBeCloseTo(50, 2);
  });

  it('+x는 동쪽 (경도 증가, 위도 거의 그대로)', () => {
    const g = toGeo(100, 0, 0);
    expect(g.lon).toBeGreaterThan(ORIGIN.lon);
    expect(g.lat).toBeCloseTo(ORIGIN.lat, 5);
    // 위도 36도에서 경도 1도 ≈ 111320 * cos(36.1°) ≈ 89.9 km -> 100 m ≈ 0.0011도
    expect(g.lon - ORIGIN.lon).toBeCloseTo(100 / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)), 4);
  });

  it('-z는 북쪽 (위도 증가)', () => {
    const g = toGeo(0, 0, -100);
    expect(g.lat).toBeGreaterThan(ORIGIN.lat);
    expect(g.lat - ORIGIN.lat).toBeCloseTo(100 / 110900, 4); // 위도 1도 ≈ 110.9 km
    expect(g.lon).toBeCloseTo(ORIGIN.lon, 5);
  });

  it('타일셋 배치 변환의 정확한 역변환이다 (임의의 ECEF 점 왕복)', () => {
    const m = computeEcefToLocalMatrix(WGS84_ELLIPSOID, ORIGIN);
    // 원점 근처 임의 지점의 ECEF 좌표를 만들어 로컬로 보냈다가 다시 경위도로 복원
    const p = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition((37.58 * Math.PI) / 180, (126.99 * Math.PI) / 180, 123.4, p);
    const local = p.clone().applyMatrix4(m);
    const g = toGeo(local.x, local.y, local.z);
    expect(g.lat).toBeCloseTo(37.58, 7);
    expect(g.lon).toBeCloseTo(126.99, 7);
    expect(g.alt).toBeCloseTo(123.4, 2);
  });
});

describe('createGeodeticToLocal', () => {
  const toLocal = createGeodeticToLocal(ORIGIN);
  const toGeo = createLocalToGeodetic(ORIGIN);

  it('기준 원점은 로컬 (0,0,0)', () => {
    const p = toLocal(ORIGIN.lon, ORIGIN.lat, 0);
    expect(p.x).toBeCloseTo(0, 3);
    expect(p.y).toBeCloseTo(0, 3);
    expect(p.z).toBeCloseTo(0, 3);
  });

  it('동쪽은 +x, 북쪽은 -z', () => {
    const east = toLocal(ORIGIN.lon + 0.001, ORIGIN.lat, 0);
    expect(east.x).toBeCloseTo(0.001 * 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180), 0);
    const north = toLocal(ORIGIN.lon, ORIGIN.lat + 0.001, 0);
    expect(north.z).toBeLessThan(0);
    expect(-north.z).toBeCloseTo(0.001 * 110900, 0);
  });

  it('createLocalToGeodetic과 서로 정확한 역변환이다', () => {
    for (const [lon, lat, alt] of [[126.99, 37.58, 123.4], [128.3, 36.08, -50], [128.41, 36.15, 0]]) {
      const p = toLocal(lon, lat, alt);
      const g = toGeo(p.x, p.y, p.z);
      expect(g.lon).toBeCloseTo(lon, 8);
      expect(g.lat).toBeCloseTo(lat, 8);
      expect(g.alt).toBeCloseTo(alt, 3);
    }
  });

  it('멀어질수록 접평면 아래로 휘어진다 (지구 곡률, 5km에서 약 2m)', () => {
    // 원점에서 정동쪽으로 약 5km 떨어진 타원체 위 점: 접평면 기준 y는 음수
    const p = toLocal(ORIGIN.lon + 5000 / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)), ORIGIN.lat, 0);
    expect(p.y).toBeLessThan(-1.5);
    expect(p.y).toBeGreaterThan(-2.5);
  });
});
