import { describe, expect, it } from 'vitest';
import { projectedAnchor } from './projectedAnchor.js';

// EPSG:5186 (서울 시청 부근) 동 198080~198100, 북 551886~551906
const Y_UP = { min: [198080, 50, -551906], max: [198100, 70, -551886] };
const Z_UP = { min: [198080, 551886, 50], max: [198100, 551906, 70] };

describe('projectedAnchor', () => {
  it('Y가 위: 북 = -z, 바닥 = min.y, 피벗은 바닥 중심', () => {
    const a = projectedAnchor({ crs: 'EPSG:5186' }, Y_UP);
    expect(a.east).toBeCloseTo(198090, 6);
    expect(a.north).toBeCloseTo(551896, 6);
    expect(a.height).toBe(50);
    expect(a.pivot).toEqual([198090, 50, -551896]);
    expect(a.lon).toBeCloseTo(126.978, 2);
    expect(a.lat).toBeCloseTo(37.567, 2);
  });

  it('Z가 위: 북 = y, 바닥 = min.z', () => {
    const a = projectedAnchor({ crs: 'EPSG:5186', upAxis: 'Z' }, Z_UP);
    expect(a.north).toBeCloseTo(551896, 6);
    expect(a.height).toBe(50);
    expect(a.pivot).toEqual([198090, 551896, 50]);
  });

  it('단위 배율을 곱한다 (mm 파일)', () => {
    const mm = { min: Y_UP.min.map((v) => v * 1000), max: Y_UP.max.map((v) => v * 1000) };
    const a = projectedAnchor({ crs: 'EPSG:5186', scale: 0.001 }, mm);
    expect(a.lat).toBeCloseTo(37.567, 2);
    expect(a.height).toBeCloseTo(50, 6);
  });

  it('범위가 없거나 경위도 범위를 벗어나면 오류', () => {
    expect(() => projectedAnchor({ crs: 'EPSG:5186' }, null)).toThrow(/범위/);
    expect(() => projectedAnchor({ crs: 'EPSG:4326' }, Y_UP)).toThrow(/경위도 범위/);
  });
});
