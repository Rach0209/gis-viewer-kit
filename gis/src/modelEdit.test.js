import { describe, expect, it } from 'vitest';
import { metersPerDegree, normalizeDeg, nudgeLonLat, pickEditable, sanitizeEdit } from './modelEdit.js';

describe('metersPerDegree', () => {
  it('위도 37.5도: 위도 1도 약 111 km(110.99), 경도 1도 약 88 km', () => {
    const m = metersPerDegree(37.5);
    expect(m.lat).toBeGreaterThan(110900);
    expect(m.lat).toBeLessThan(111100);
    expect(m.lon).toBeGreaterThan(88000);
    expect(m.lon).toBeLessThan(89000);
  });
  it('적도에서는 경도 1도가 약 111.3 km', () => {
    expect(metersPerDegree(0).lon).toBeCloseTo(111319.5, -1);
  });
});

describe('nudgeLonLat', () => {
  const p = { lon: 126.978, lat: 37.5665 };
  it('북쪽으로 100 m는 위도가 약 0.0009도 오르고 경도는 그대로', () => {
    const q = nudgeLonLat(p, 0, 100);
    expect(q.lat - p.lat).toBeCloseTo(0.0009, 4);
    expect(q.lon).toBe(p.lon);
  });
  it('동쪽으로 100 m는 경도가 약 0.00113도 오른다', () => {
    const q = nudgeLonLat(p, 100, 0);
    expect(q.lon - p.lon).toBeCloseTo(0.00113, 5);
    expect(q.lat).toBe(p.lat);
  });
  it('동쪽 후 서쪽으로 같은 만큼 가면 거의 제자리', () => {
    const q = nudgeLonLat(nudgeLonLat(p, 50, -30), -50, 30);
    expect(q.lon).toBeCloseTo(p.lon, 7);
    expect(q.lat).toBeCloseTo(p.lat, 7);
  });
  it('극 근처로는 못 간다', () => {
    expect(nudgeLonLat({ lon: 0, lat: 89.8 }, 0, 100000).lat).toBe(89.9);
  });
});

describe('normalizeDeg', () => {
  it('(-180, 180] 로 맞춘다', () => {
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(540)).toBe(180);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(45)).toBe(45);
  });
});

describe('sanitizeEdit', () => {
  it('각도와 기울기, 위도를 범위로 정리한다', () => {
    expect(sanitizeEdit({ headingDeg: 270, pitchDeg: 120, rollDeg: -200, lat: 95 })).toEqual({ headingDeg: -90, pitchDeg: 90, rollDeg: -90, lat: 89.9 });
  });
  it('크기가 0 이하이면 오류 (mm 안내 포함)', () => {
    expect(() => sanitizeEdit({ scale: 0 })).toThrow(/0보다 큰/);
    expect(() => sanitizeEdit({ scale: -1 })).toThrow();
  });
  it('숫자가 아니면 오류, 모르는 항목은 무시', () => {
    expect(() => sanitizeEdit({ height: NaN })).toThrow(/숫자/);
    expect(() => sanitizeEdit({ height: '5' })).toThrow(/숫자/);
    expect(sanitizeEdit({ 이상한: 1, height: 5 })).toEqual({ height: 5 });
  });
  it('위쪽 축은 Y 또는 Z', () => {
    expect(sanitizeEdit({ upAxis: 'Z' })).toEqual({ upAxis: 'Z' });
    expect(() => sanitizeEdit({ upAxis: 'X' })).toThrow();
  });
});

it('pickEditable: 편집 값만 복사하고 빠진 값은 기본값', () => {
  expect(pickEditable({ lon: 1, lat: 2, height: 3, file: 'x', pivot: [1] })).toEqual({ lon: 1, lat: 2, height: 3, headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: 1, upAxis: 'Y' });
});
