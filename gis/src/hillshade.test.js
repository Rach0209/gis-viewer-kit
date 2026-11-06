import { describe, expect, it } from 'vitest';
import { hillshadeTile } from './hillshade.js';

const D2R = Math.PI / 180;
const rect = { west: 127 * D2R, south: 37.5 * D2R, east: 127.001 * D2R, north: 37.501 * D2R }; // 약 88m x 111m
const M_PER_DEG_LON = 111320 * Math.cos(37.5 * D2R);
const eastM = (lon) => (lon - 127) * M_PER_DEG_LON;

const px = (data, size, i, j) => {
  const o = (j * size + i) * 4;
  return { r: data[o], a: data[o + 3] };
};

describe('hillshadeTile', () => {
  const size = 8;
  it('평평한 곳은 거의 투명', () => {
    const d = hillshadeTile(rect, size, () => 50);
    for (let k = 3; k < d.length; k += 4) expect(d[k]).toBe(0);
  });
  it('동쪽으로 올라가는 비탈(서쪽을 봄)은 북서쪽 빛을 받아 밝다(흰색)', () => {
    const d = hillshadeTile(rect, size, (lon) => eastM(lon) * 0.5);
    const p = px(d, size, 4, 4);
    expect(p.r).toBe(255);
    expect(p.a).toBeGreaterThan(20);
  });
  it('서쪽으로 올라가는 비탈(동쪽을 봄)은 그림자(검정)', () => {
    const d = hillshadeTile(rect, size, (lon) => -eastM(lon) * 0.5);
    const p = px(d, size, 4, 4);
    expect(p.r).toBe(0);
    expect(p.a).toBeGreaterThan(20);
  });
  it('값 없는 곳은 투명, 이웃이 값 없어도 오류 없이', () => {
    const d = hillshadeTile(rect, size, (lon, lat) => (lat > 37.5005 ? null : 10 + eastM(lon)));
    expect(px(d, size, 4, 0).a).toBe(0); // 북쪽 절반은 값 없음
    expect(d).toHaveLength(size * size * 4);
    expect(px(d, size, 4, 7).a).toBeGreaterThanOrEqual(0);
  });
  it('높이 과장(zFactor)을 키우면 같은 비탈이 더 진하다', () => {
    const f = (lon) => -eastM(lon) * 0.2;
    const a1 = px(hillshadeTile(rect, size, f, { zFactor: 1 }), size, 4, 4).a;
    const a3 = px(hillshadeTile(rect, size, f, { zFactor: 3 }), size, 4, 4).a;
    expect(a3).toBeGreaterThan(a1);
  });
});
