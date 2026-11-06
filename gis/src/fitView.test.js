import { describe, expect, it } from 'vitest';
import { fitTopDown, freeRect } from './fitView.js';

describe('freeRect', () => {
  it('패널이 없으면 캔버스 전체에서 가장자리 여유만 뺀다', () => {
    expect(freeRect(400, 300, [], { edge: 10 })).toEqual({ left: 10, top: 10, right: 390, bottom: 290 });
  });
  it('아래쪽 패널이 있으면 그 위의 넓은 영역을 고른다', () => {
    const r = freeRect(478, 767, [{ left: 10, top: 447, right: 320, bottom: 757 }], { edge: 16, around: 12 });
    expect(r.top).toBe(16);
    expect(r.bottom).toBeLessThanOrEqual(447 - 12 - 16 + 16); // 패널 위쪽 여유 안
    expect(r.right - r.left).toBeGreaterThan(400);
  });
  it('좌우 패널 사이의 영역도 후보다 (넓은 화면, 왼쪽 패널)', () => {
    const r = freeRect(1200, 700, [{ left: 10, top: 10, right: 340, bottom: 300 }], { edge: 16, around: 12 });
    // 패널 오른쪽으로 길게 뻗은 영역이 가장 넓다
    expect(r.left).toBeGreaterThanOrEqual(340);
    expect(r.right).toBe(1184);
    expect(r.bottom).toBe(684);
  });
  it('결과는 패널과 겹치지 않는다', () => {
    const panels = [{ left: 10, top: 10, right: 340, bottom: 200 }, { left: 10, top: 500, right: 320, bottom: 690 }, { left: 800, top: 600, right: 990, bottom: 690 }];
    const r = freeRect(1000, 700, panels);
    for (const p of panels) expect(r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top).toBe(false);
  });
  it('들어갈 곳이 없으면 캔버스 전체', () => {
    expect(freeRect(300, 300, [{ left: 0, top: 0, right: 300, bottom: 300 }], { edge: 10 })).toEqual({ left: 10, top: 10, right: 290, bottom: 290 });
  });
});

describe('fitTopDown', () => {
  const deg = Math.PI / 180;
  const pts = [{ lon: 127 * deg, lat: 37.5 * deg }, { lon: (127 + 0.001) * deg, lat: (37.5 + 0.0005) * deg }]; // 동서 약 88m, 남북 약 56m
  const common = { W: 1000, H: 800, metersPerPxPerHeight: 0.002 };

  it('rect가 캔버스 중앙이면 점들 상자의 중심을 가운데로', () => {
    const r = fitTopDown(pts, { left: 100, top: 100, right: 900, bottom: 700 }, common);
    expect(r.lon / deg).toBeCloseTo(127.0005, 6);
    expect(r.lat / deg).toBeCloseTo(37.50025, 6);
  });
  it('점들이 rect에 여유 있게 다 들어가는 높이 (가로가 긴 경우)', () => {
    const rect = { left: 100, top: 100, right: 900, bottom: 700 }; // 800 x 600 px
    const r = fitTopDown(pts, rect, { ...common, pad: 0.2 });
    // 가로 약 88m*1.4=123m 를 800px 에: 0.154 m/px -> 높이 0.154/0.002 = 77 m
    const eastM = 0.001 * deg * 6378137 * Math.cos(37.5 * deg);
    expect(r.height).toBeCloseTo((eastM * 1.4) / 800 / 0.002, 0);
  });
  it('세로가 긴 rect면 세로 기준으로 맞춘다', () => {
    const tall = [{ lon: 127 * deg, lat: 37.5 * deg }, { lon: (127 + 0.0001) * deg, lat: (37.5 + 0.002) * deg }]; // 남북 약 222m
    const r = fitTopDown(tall, { left: 100, top: 100, right: 900, bottom: 700 }, common);
    const northM = 0.002 * deg * 6378137;
    expect(r.height).toBeCloseTo((northM * 1.4) / 600 / 0.002, 0);
  });
  it('rect가 아래쪽 패널 때문에 위로 치우쳐 있으면 카메라 중심은 점들보다 남쪽(아래)이 아니라 북쪽 위치가 아닌, 점이 위쪽에 보이도록 남쪽으로 이동', () => {
    // 점들이 화면 위쪽(rect 중심이 캔버스 중심보다 위)에 오려면, 캔버스 중심(카메라 중심)은 점들보다 남쪽
    const upper = { left: 100, top: 20, right: 900, bottom: 300 }; // 캔버스 중심(400)보다 위
    const base = fitTopDown(pts, { left: 100, top: 100, right: 900, bottom: 700 }, common);
    const r = fitTopDown(pts, upper, common);
    expect(r.lat).toBeLessThan(base.lat);
  });
  it('rect가 오른쪽으로 치우쳐 있으면 카메라 중심은 점들보다 서쪽', () => {
    const right = { left: 500, top: 100, right: 980, bottom: 700 };
    const base = fitTopDown(pts, { left: 100, top: 100, right: 900, bottom: 700 }, common);
    expect(fitTopDown(pts, right, common).lon).toBeLessThan(base.lon);
  });
  it('점이 하나뿐이거나 한 곳에 모여도 최소 크기를 보여 준다', () => {
    const r = fitTopDown([pts[0], pts[0]], { left: 0, top: 0, right: 800, bottom: 600 }, common);
    expect(r.height).toBeGreaterThan(0);
    expect(r.height).toBeCloseTo((20 * 1.4) / 600 / 0.002 > (20 * 1.4) / 800 / 0.002 ? (20 * 1.4) / 600 / 0.002 : (20 * 1.4) / 800 / 0.002, 0);
  });
});
