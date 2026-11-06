import { describe, expect, it } from 'vitest';
import { dashToCesium, lineMidpoint, pointInPolygon, pointInRing, polygonLabelPoint, ringCentroid } from './geomLabel.js';

const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe('pointInRing / pointInPolygon', () => {
  it('안과 밖, 구멍', () => {
    expect(pointInRing([5, 5], square)).toBe(true);
    expect(pointInRing([15, 5], square)).toBe(false);
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
    expect(pointInPolygon([5, 5], square, [hole])).toBe(false);
    expect(pointInPolygon([2, 2], square, [hole])).toBe(true);
  });
});

describe('ringCentroid', () => {
  it('정사각형의 중심', () => {
    const c = ringCentroid(square);
    expect(c[0]).toBeCloseTo(5, 6);
    expect(c[1]).toBeCloseTo(5, 6);
  });
  it('직각삼각형은 꼭짓점 평균(삼각형 중심)', () => {
    const c = ringCentroid([[0, 0], [9, 0], [0, 9]]);
    expect(c[0]).toBeCloseTo(3, 4);
    expect(c[1]).toBeCloseTo(3, 4);
  });
});

describe('polygonLabelPoint', () => {
  it('볼록한 면은 중심', () => {
    const p = polygonLabelPoint(square);
    expect(p[0]).toBeCloseTo(5, 6);
    expect(p[1]).toBeCloseTo(5, 6);
  });
  it('가운데에 큰 구멍이 있으면 구멍 밖(면 안)의 점', () => {
    const hole = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
    const p = polygonLabelPoint(square, [hole]);
    expect(pointInPolygon(p, square, [hole])).toBe(true);
  });
  it('U자(오목) 면: 중심이 밖이어도 면 안의 점', () => {
    const thin = [[0, 0], [10, 0], [10, 10], [9, 10], [9, 1], [1, 1], [1, 10], [0, 10], [0, 0]];
    expect(pointInRing(ringCentroid(thin), thin)).toBe(false); // 얇은 U자는 중심이 안뜰(밖)에 떨어진다
    const p = polygonLabelPoint(thin);
    expect(pointInPolygon(p, thin)).toBe(true);
  });
});

describe('lineMidpoint', () => {
  it('길이의 절반 지점', () => {
    const m = lineMidpoint([[0, 0], [10, 0]]);
    expect(m[0]).toBeCloseTo(5, 6);
    const bent = lineMidpoint([[0, 0], [0, 10], [10, 10]]); // 전체 20 (위도 쪽 10 + 경도 쪽 10*cos(5도)=약 9.96)
    expect(bent[1]).toBeCloseTo(10, 0);
    expect(lineMidpoint([[3, 4]])).toEqual([3, 4]);
  });
});

describe('dashToCesium', () => {
  it('"5 5" (절반 켜고 절반 끔): 한 주기 10, 16비트 중 8비트', () => {
    const d = dashToCesium([5, 5]);
    expect(d.dashLength).toBe(10);
    const bits = d.dashPattern.toString(2).split('1').length - 1;
    expect(bits).toBe(8);
  });
  it('홀수 개는 반복: "3" -> 3 켜고 3 끔', () => {
    expect(dashToCesium([3]).dashLength).toBe(6);
  });
  it('켬이 길수록 켜진 비트가 많다', () => {
    const count = (n) => n.toString(2).split('1').length - 1;
    expect(count(dashToCesium([12, 4]).dashPattern)).toBeGreaterThan(count(dashToCesium([4, 12]).dashPattern));
  });
});
