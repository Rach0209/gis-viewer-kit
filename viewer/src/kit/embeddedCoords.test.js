import { describe, expect, it } from 'vitest';
import { embeddedCandidates, guessCrs } from './embeddedCoords.js';

// 투영 좌표(EPSG:5186 동·북)가 노드 이동값에 들어 있는 건물 glb의 모양: 중심 (198091.708, 145.5, -551896.121)
const CENTER = [198091.708, 145.5, -551896.121];

describe('embeddedCandidates', () => {
  it('원점 근처의 일반 모델은 null', () => {
    expect(embeddedCandidates([10, 5, -20])).toBeNull();
    expect(embeddedCandidates(null)).toBeNull();
  });

  it('멀리 있으면 Y-위/Z-위 두 가지 읽기를 만든다', () => {
    const c = embeddedCandidates(CENTER);
    expect(c.yUp).toEqual({ east: 198091.708, north: 551896.121, elev: 145.5 });
    expect(c.zUp).toEqual({ east: 198091.708, north: 145.5, elev: -551896.121 });
  });

  it('한쪽 축으로만 멀면 그쪽 후보만 만든다', () => {
    const c = embeddedCandidates([0, 0, -9000]); // Y-위로는 멀지만 Z-위(x,y)로는 가깝다
    expect(c.yUp).not.toBeNull();
    expect(c.zUp).toBeNull();
  });
});

describe('guessCrs: 실제 파일 값으로', () => {
  const cand = embeddedCandidates(CENTER);

  it('Y-위로 읽으면 5186이 서울 시청 부근(경도 126.978, 위도 37.567)이고 가장 먼저 나온다', () => {
    const g = guessCrs(cand.yUp);
    expect(g[0].crs).toBe('EPSG:5186');
    expect(g[0].lon).toBeCloseTo(126.978, 2);
    expect(g[0].lat).toBeCloseTo(37.567, 2);
    expect(g[0].elev).toBeCloseTo(145.5, 3);
  });

  it('5185/5187도 한국 주변 경도로 나오지만(바다 위) 5186 뒤에 후보로만 남는다', () => {
    const crs = guessCrs(cand.yUp).map((g) => g.crs);
    expect(crs.indexOf('EPSG:5186')).toBeLessThan(crs.indexOf('EPSG:5187'));
    expect(crs.indexOf('EPSG:5186')).toBeLessThan(crs.indexOf('EPSG:5185'));
  });

  it('5179는 한국 밖(중국 동쪽 바다)으로 나와 후보에서 빠진다', () => {
    expect(guessCrs(cand.yUp).map((g) => g.crs)).not.toContain('EPSG:5179');
  });

  it('Z-위로 읽으면 높이가 -551,896 m 라 불가능해서 후보가 없다', () => {
    expect(guessCrs(cand.zUp)).toEqual([]);
  });

  it('단위가 mm일 때: 좌표와 높이에 배율을 곱해 판단한다', () => {
    const mm = { east: 198091708, north: 551896121, elev: 145500 };
    expect(guessCrs(mm, 1)).toEqual([]); // 배율 1이면 높이 145,500 m 로 불가능
    expect(guessCrs(mm, 0.001)[0].crs).toBe('EPSG:5186');
  });

  it('후보가 없으면 빈 배열', () => {
    expect(guessCrs(null)).toEqual([]);
    expect(guessCrs({ east: 1, north: 2, elev: 3 })).toEqual([]);
  });
});

import { findEmbeddedPlacements } from './embeddedCoords.js';

describe('findEmbeddedPlacements', () => {
  it('일반 모델은 아무것도 추천하지 않는다 (대부분의 glb)', () => {
    expect(findEmbeddedPlacements({ center: [3, 2, -4] })).toEqual({ suggestions: [], warnings: [] });
    expect(findEmbeddedPlacements({ center: null })).toEqual({ suggestions: [], warnings: [] });
  });

  it('내장 좌표가 있는 파일이면 5186 Y축-위 추천을 맨 앞에 낸다', () => {
    const r = findEmbeddedPlacements({ center: CENTER });
    expect(r.suggestions[0].spec).toEqual({ type: 'projected', crs: 'EPSG:5186', upAxis: 'Y', scale: 1 });
    expect(r.suggestions[0].label).toMatch(/126\.97\d+/);
    expect(r.warnings[0]).toMatch(/추천 위치/);
    expect(r.suggestions).toHaveLength(1); // 5187/5185 같은 우연한 후보는 내지 않는다
  });

  it('mm 단위 파일이면 배율 0.001을 추천한다', () => {
    const r = findEmbeddedPlacements({ center: [198091708, 145500, -551896121] });
    expect(r.suggestions[0].spec.scale).toBe(0.001);
  });

  it('한국 안으로 읽히지 않는 먼 모델은 추천 없이 경고만 낸다', () => {
    const r = findEmbeddedPlacements({ center: [9e5, 10, 9e5] });
    expect(r.suggestions).toEqual([]);
    expect(r.warnings[0]).toMatch(/안 보일 수 있습니다/);
  });
});

describe('findEmbeddedPlacements: 좌표계 후보(alternatives)', () => {
  it('추천 하나에 한국 안으로 읽히는 좌표계를 모두 담고, 첫 번째가 기본(5186)이다', () => {
    const [s] = findEmbeddedPlacements({ center: CENTER }).suggestions;
    expect(s.alternatives.map((a) => a.crs)).toEqual(['EPSG:5186', 'EPSG:5187', 'EPSG:5185']);
    expect(s.spec.crs).toBe(s.alternatives[0].crs);
  });

  it('후보마다 경위도가 다르다 (같은 숫자라도 원점에 따라 위치가 달라짐)', () => {
    const [s] = findEmbeddedPlacements({ center: CENTER }).suggestions;
    const lons = s.alternatives.map((a) => a.lon);
    expect(new Set(lons.map((x) => x.toFixed(2))).size).toBe(3);
    expect(s.alternatives[0].lon).toBeCloseTo(126.978, 2); // 5186
    expect(s.alternatives[1].lon).toBeCloseTo(s.alternatives[0].lon + 2, 1); // 5187 = 동부원점(+2도)
  });
});
