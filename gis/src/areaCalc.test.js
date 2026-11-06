import { describe, expect, it } from 'vitest';
import { AUTHALIC_RADIUS, polygonAreaM2, ringAreaM2 } from './areaCalc.js';
import { formatArea } from './coordFormat.js';

const D2R = Math.PI / 180;
/** 기준 위도에서 동쪽 dx(m), 북쪽 dy(m) 떨어진 점 (작은 범위용 근사) */
const at = (lon0, lat0, dx, dy) => [lon0 + dx / (111320 * Math.cos(lat0 * D2R)), lat0 + dy / 110990];

describe('ringAreaM2', () => {
  it('같은 넓이의 구 반지름', () => {
    expect(AUTHALIC_RADIUS).toBeCloseTo(6371007.18, 0);
  });
  it('적도에서 1도 x 1도 상자는 약 12,300 km² (구 반지름 오차 이내)', () => {
    const a = ringAreaM2([[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(a / 1e6).toBeGreaterThan(12290);
    expect(a / 1e6).toBeLessThan(12390);
  });
  it('위도 37.5도의 0.01도 x 0.01도 상자: 변 길이로 계산한 값과 0.2% 이내', () => {
    const a = ringAreaM2([[127, 37.5], [127.01, 37.5], [127.01, 37.51], [127, 37.51]]);
    const expected = 0.01 * 111320 * Math.cos(37.505 * D2R) * (0.01 * 110990);
    expect(Math.abs(a - expected) / expected).toBeLessThan(0.002);
  });
  it('1000 m 직각이등변삼각형은 500,000 m² (0.2% 이내), 방향·닫힘 표시와 무관', () => {
    const p = [at(127, 37.5, 0, 0), at(127, 37.5, 1000, 0), at(127, 37.5, 0, 1000)];
    const a = ringAreaM2(p);
    expect(Math.abs(a - 500000) / 500000).toBeLessThan(0.002);
    expect(ringAreaM2([...p].reverse())).toBeCloseTo(a, 3);
    expect(ringAreaM2([...p, p[0]])).toBeCloseTo(a, 3);
  });
  it('점이 3개 미만이면 0', () => {
    expect(ringAreaM2([[0, 0], [1, 1]])).toBe(0);
    expect(ringAreaM2([])).toBe(0);
  });
  it('날짜 변경선을 가로지르는 상자도 같은 면적', () => {
    const a = ringAreaM2([[179.5, 10], [180.5, 10], [180.5, 11], [179.5, 11]]);
    const b = ringAreaM2([[179.5, 10], [-179.5, 10], [-179.5, 11], [179.5, 11]]);
    expect(b).toBeCloseTo(a, 0);
  });
  it('긴 변(수천 km)은 대원을 따라 나눠서 계산한다: 북위 60도의 90도 폭 구면 삼각형', () => {
    // 북극점과 적도 위 경도 0, 90도를 이은 삼각형은 지구 표면의 1/8 = 4π R²/8 = π R²/2
    const a = ringAreaM2([[0, 90], [0, 0], [90, 0]]);
    expect(Math.abs(a - (Math.PI * AUTHALIC_RADIUS ** 2) / 2) / ((Math.PI * AUTHALIC_RADIUS ** 2) / 2)).toBeLessThan(0.01);
  });
});

describe('polygonAreaM2', () => {
  it('구멍을 뺀다', () => {
    const outer = [at(127, 37.5, 0, 0), at(127, 37.5, 1000, 0), at(127, 37.5, 1000, 1000), at(127, 37.5, 0, 1000)];
    const hole = [at(127, 37.5, 250, 250), at(127, 37.5, 750, 250), at(127, 37.5, 750, 750), at(127, 37.5, 250, 750)];
    const full = polygonAreaM2(outer);
    const holed = polygonAreaM2(outer, [hole]);
    expect(Math.abs(full - 1e6) / 1e6).toBeLessThan(0.003);
    expect(Math.abs(holed - 750000) / 750000).toBeLessThan(0.003);
  });
});

describe('formatArea', () => {
  it('㎡ / ha / ㎢ 와 평', () => {
    expect(formatArea(0)).toBe('0.0 ㎡ (0.0평)');
    expect(formatArea(1234.56)).toBe('1,234.6 ㎡ (373.5평)');
    expect(formatArea(250000)).toBe('25.00 ha (75,625평)');
    expect(formatArea(3.5e6)).toBe('3.500 ㎢ (1.06백만평)');
    expect(formatArea(NaN)).toBe('–');
  });
});
