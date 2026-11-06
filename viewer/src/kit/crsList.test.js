import { describe, expect, it } from 'vitest';
import { CRS_LIST, DEFAULT_CRS, fromLonLat, getCrs, isNearKorea, isValidLonLat, toLonLat } from './crsList.js';

describe('CRS_LIST', () => {
  it('4326과 5179를 포함하고 모두 3개 이상이며 기본값은 5179다', () => {
    const codes = CRS_LIST.map((c) => c.code);
    expect(codes).toContain('EPSG:4326');
    expect(codes).toContain('EPSG:5179');
    expect(codes.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_CRS).toBe('EPSG:5179');
  });

  it('코드가 중복되지 않는다', () => {
    const codes = CRS_LIST.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('알 수 없는 코드는 오류', () => {
    expect(() => getCrs('EPSG:9999')).toThrow(/지원하지 않는/);
  });
});

describe('toLonLat / fromLonLat — 정의로 정해지는 기준점 (거짓 원점은 구현과 무관한 값)', () => {
  it('4326은 그대로다', () => {
    expect(toLonLat('EPSG:4326', 126.98, 37.57)).toEqual({ lon: 126.98, lat: 37.57 });
  });

  it('5179: 중앙자오선 127.5E, 위도 38N 은 (1000000, 2000000)', () => {
    const p = fromLonLat('EPSG:5179', 127.5, 38);
    expect(p.x).toBeCloseTo(1000000, 3);
    expect(p.y).toBeCloseTo(2000000, 3);
    const g = toLonLat('EPSG:5179', 1000000, 2000000);
    expect(g.lon).toBeCloseTo(127.5, 9);
    expect(g.lat).toBeCloseTo(38, 9);
  });

  it.each([
    ['EPSG:5185', 125],
    ['EPSG:5186', 127],
    ['EPSG:5187', 129],
  ])('%s: 중앙자오선 %sE, 38N 은 (200000, 600000)', (code, lon0) => {
    const p = fromLonLat(code, lon0, 38);
    expect(p.x).toBeCloseTo(200000, 3);
    expect(p.y).toBeCloseTo(600000, 3);
  });

  it('3857: (0E, 0N)은 (0, 0), 180E는 x=20037508.34', () => {
    const o = fromLonLat('EPSG:3857', 0, 0);
    expect(o.x).toBeCloseTo(0, 6);
    expect(o.y).toBeCloseTo(0, 6);
    expect(fromLonLat('EPSG:3857', 180, 0).x).toBeCloseTo(20037508.34, 1);
  });

  it('모든 좌표계에서 경위도 -> 좌표 -> 경위도 왕복 오차가 1e-9도 이하', () => {
    for (const c of CRS_LIST) {
      const p = fromLonLat(c.code, 126.978, 37.5665);
      const g = toLonLat(c.code, p.x, p.y);
      expect(g.lon).toBeCloseTo(126.978, 9);
      expect(g.lat).toBeCloseTo(37.5665, 9);
    }
  });

  it('같은 지점의 5179 와 5186 좌표는 다르지만 같은 경위도로 돌아온다', () => {
    const a = fromLonLat('EPSG:5179', 126.98, 37.57);
    const b = fromLonLat('EPSG:5186', 126.98, 37.57);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(1000);
    const ga = toLonLat('EPSG:5179', a.x, a.y);
    const gb = toLonLat('EPSG:5186', b.x, b.y);
    expect(ga.lon).toBeCloseTo(gb.lon, 8);
    expect(ga.lat).toBeCloseTo(gb.lat, 8);
  });

  it('숫자가 아니면 오류', () => {
    expect(() => toLonLat('EPSG:5179', NaN, 1)).toThrow();
  });
});

describe('범위 확인', () => {
  it('유효한 경위도', () => {
    expect(isValidLonLat({ lon: 128, lat: 36 })).toBe(true);
    expect(isValidLonLat({ lon: 200, lat: 36 })).toBe(false);
    expect(isValidLonLat({ lon: 128, lat: 95 })).toBe(false);
  });

  it('한국 주변 여부: 5179 좌표를 4326으로 잘못 넣으면 한국 밖/무효로 잡힌다', () => {
    expect(isNearKorea({ lon: 126.98, lat: 37.57 })).toBe(true);
    expect(isNearKorea({ lon: 0, lat: 0 })).toBe(false);
    // 5179 값 (953901, 1952032)을 4326 경위도로 해석하면 무효
    expect(isValidLonLat({ lon: 953901, lat: 1952032 })).toBe(false);
  });
});
