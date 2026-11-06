import { describe, expect, it } from 'vitest';
import { bilinear, createMosaicSampler, createSampler, crsFromGeoKeys, guessDemCrs, heightStats, inverseFor, isNoData, isSupportedCrs, lonLatExtent, projectorFor, tileHeights } from './demCore.js';

describe('bilinear', () => {
  // 3x2 격자: 행0 = 0 10 20, 행1 = 100 110 120
  const d = [0, 10, 20, 100, 110, 120];
  it('화소 중심 값은 그대로', () => {
    expect(bilinear(d, 3, 2, 0, 0)).toBe(0);
    expect(bilinear(d, 3, 2, 2, 1)).toBe(120);
    expect(bilinear(d, 3, 2, 1, 0)).toBe(10);
  });
  it('사이는 선형 보간', () => {
    expect(bilinear(d, 3, 2, 0.5, 0)).toBeCloseTo(5, 6);
    expect(bilinear(d, 3, 2, 0, 0.5)).toBeCloseTo(50, 6);
    expect(bilinear(d, 3, 2, 1.5, 0.5)).toBeCloseTo(65, 6);
  });
  it('가장자리 반 화소는 가장자리 값', () => {
    expect(bilinear(d, 3, 2, -0.5, 0)).toBe(0);
    expect(bilinear(d, 3, 2, 2.5, 1)).toBe(120);
  });
  it('값 없는 이웃은 빼고 계산, 전부 없으면 null', () => {
    const n = [0, -9999, 20, 100, 110, 120];
    expect(bilinear(n, 3, 2, 0.5, 0, -9999)).toBeCloseTo(0, 6); // 오른쪽 위 이웃이 없어서 남은 값만
    expect(bilinear([-9999, -9999, -9999, -9999], 2, 2, 0.5, 0.5, -9999)).toBeNull();
  });
});

it('isNoData', () => {
  expect(isNoData(-9999, -9999)).toBe(true);
  expect(isNoData(NaN)).toBe(true);
  expect(isNoData(-3.4e38)).toBe(true);
  expect(isNoData(0, -9999)).toBe(false);
  expect(isNoData(-50)).toBe(false);
});

describe('createSampler', () => {
  // 4x4 격자, 화소 1도, 범위 경도 10~14, 위도 20~24. 높이 = 100*열 + 행 (열은 서->동, 행은 북->남)
  const w = 4;
  const data = Array.from({ length: 16 }, (_, i) => 100 * (i % w) + Math.floor(i / w));
  const s = createSampler({ data, width: 4, height: 4, bbox: [10, 20, 14, 24] }, (lon, lat) => [lon, lat]);
  it('화소 중심에서 정확한 값 (왼쪽 위 화소 중심 = 경도 10.5, 위도 23.5)', () => {
    expect(s.sampleLonLat(10.5, 23.5)).toBe(0);
    expect(s.sampleLonLat(11.5, 23.5)).toBe(100);
    expect(s.sampleLonLat(10.5, 22.5)).toBe(1);
    expect(s.sampleLonLat(13.5, 20.5)).toBe(303);
  });
  it('범위 밖은 null, 경계는 값', () => {
    expect(s.sampleLonLat(9.99, 22)).toBeNull();
    expect(s.sampleLonLat(12, 24.01)).toBeNull();
    expect(s.sampleLonLat(10, 24)).toBe(0);
  });
});

describe('tileHeights', () => {
  const deg = Math.PI / 180;
  const rect = { west: 10 * deg, south: 20 * deg, east: 12 * deg, north: 22 * deg };
  it('행 0이 북쪽, 열 0이 서쪽, 가장자리가 타일 경계', () => {
    const h = tileHeights(rect, 3, (lon, lat) => lon * 1000 + lat);
    expect(h[0]).toBeCloseTo(10 * 1000 + 22, 2); // 북서
    expect(h[2]).toBeCloseTo(12 * 1000 + 22, 2); // 북동
    expect(h[6]).toBeCloseTo(10 * 1000 + 20, 2); // 남서
    expect(h[8]).toBeCloseTo(12 * 1000 + 20, 2); // 남동
    expect(h[4]).toBeCloseTo(11 * 1000 + 21, 2); // 가운데
  });
  it('값 없는 곳은 outside, 높이 보정 더함', () => {
    const h = tileHeights(rect, 3, (lon) => (lon < 11 ? 5 : null), { offset: 27, outside: -1 });
    expect(h[0]).toBe(32);
    expect(h[2]).toBe(-1);
    expect(h).toBeInstanceOf(Float32Array);
  });
});

it('heightStats', () => {
  expect(heightStats([1, 2, 3, -9999, NaN], -9999)).toEqual({ min: 1, max: 3, mean: 2, valid: 3, invalid: 2 });
  expect(heightStats([-9999], -9999).min).toBeNull();
});

describe('좌표계', () => {
  it('GeoKeys에서 코드 찾기', () => {
    expect(crsFromGeoKeys({ ProjectedCSTypeGeoKey: 5186 })).toBe('EPSG:5186');
    expect(crsFromGeoKeys({ GeographicTypeGeoKey: 4326 })).toBe('EPSG:4326');
    expect(crsFromGeoKeys({ GeographicTypeGeoKey: 4737 })).toBe('EPSG:4737');
    expect(crsFromGeoKeys({ ProjectedCSTypeGeoKey: 32652 })).toBe('EPSG:32652');
    expect(crsFromGeoKeys({ ProjectedCSTypeGeoKey: 5174 })).toBeNull(); // 옛 좌표계는 사용자가 고른다
    expect(crsFromGeoKeys({ ProjectedCSTypeGeoKey: 32767 })).toBeNull();
    expect(crsFromGeoKeys({})).toBeNull();
    expect(crsFromGeoKeys(null)).toBeNull();
  });
  it('지원 여부', () => {
    expect(isSupportedCrs('EPSG:5179')).toBe(true);
    expect(isSupportedCrs('EPSG:32651')).toBe(true);
    expect(isSupportedCrs('EPSG:5174')).toBe(false);
    expect(isSupportedCrs(undefined)).toBe(false);
  });
  it('중부원점 5186의 원점(127E, 38N)은 (200000, 600000)', () => {
    const [x, y] = projectorFor('EPSG:5186')(127, 38);
    expect(x).toBeCloseTo(200000, 2);
    expect(y).toBeCloseTo(600000, 2);
  });
  it('투영 왕복 (5186 / 5179 / UTM 52N / 경위도 / 5185)', () => {
    for (const code of ['EPSG:5186', 'EPSG:5179', 'EPSG:32652', 'EPSG:4326', 'EPSG:5185']) {
      const [x, y] = projectorFor(code)(127.3, 37.4);
      const [lon, lat] = inverseFor(code)(x, y);
      expect(lon).toBeCloseTo(127.3, 7);
      expect(lat).toBeCloseTo(37.4, 7);
    }
  });
  it('경위도 범위: 5186 격자 상자의 경위도 범위가 상자를 포함하고 크기가 맞다', () => {
    const [cx, cy] = projectorFor('EPSG:5186')(127, 37.5);
    const ext = lonLatExtent([cx - 1000, cy - 1000, cx + 1000, cy + 1000], 'EPSG:5186');
    expect(ext[0]).toBeLessThan(127);
    expect(ext[2]).toBeGreaterThan(127);
    expect(ext[1]).toBeLessThan(37.5);
    expect(ext[3]).toBeGreaterThan(37.5);
    expect(ext[2] - ext[0]).toBeCloseTo(2000 / (111320 * Math.cos((37.5 * Math.PI) / 180)), 3);
  });
});

describe('guessDemCrs', () => {
  it('값 범위로 좌표계를 추정한다', () => {
    expect(guessDemCrs([127.0, 37.5, 127.1, 37.6])).toBe('EPSG:4326');
    const p5179 = projectorFor('EPSG:5179')(127, 37.5);
    expect(guessDemCrs([p5179[0], p5179[1], p5179[0] + 2000, p5179[1] + 2000])).toBe('EPSG:5179');
    const p5186 = projectorFor('EPSG:5186')(127, 37.5);
    expect(guessDemCrs([p5186[0], p5186[1], p5186[0] + 2000, p5186[1] + 2000])).toBe('EPSG:5186');
  });
  it('한국 밖이면 null', () => {
    expect(guessDemCrs([10, 10, 11, 11])).toBeNull();
    expect(guessDemCrs([5000000, 5000000, 5001000, 5001000])).toBeNull();
  });
});

describe('createMosaicSampler', () => {
  // 높이 = x + y 인 평면을, 격자 시작 위치와 간격이 서로 다른 두 도엽으로 나눠 담는다
  const make = (x0, y1, res, w, h) => {
    const data = [];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data.push(x0 + (c + 0.5) * res + (y1 - (r + 0.5) * res));
    return { data, width: w, height: h, bbox: [x0, y1 - h * res, x0 + w * res, y1] };
  };
  const a = make(0, 100, 10, 10, 10); // 0~100 x 0~100, 10 m
  const b = make(103, 100, 7, 10, 14); // 103~173 x 2~100, 7 m (시작 위치와 간격이 다름)
  const s = createMosaicSampler([a, b], (lon, lat) => [lon, lat]);
  it('각 도엽 안에서는 그 도엽 값 (평면이라 보간해도 정확)', () => {
    expect(s.sampleXY(50, 50)).toBeCloseTo(100, 6);
    expect(s.sampleXY(140, 60)).toBeCloseTo(200, 6);
  });
  it('도엽 사이 한 칸 안의 틈(100~103)은 가까운 도엽 가장자리 값으로 메운다', () => {
    const v = s.sampleXY(101.5, 50);
    expect(v).not.toBeNull();
    expect(v).toBeGreaterThan(130);
    expect(v).toBeLessThan(170);
  });
  it('어느 도엽에도 없으면 null (한 칸보다 멀리)', () => {
    expect(s.sampleXY(300, 50)).toBeNull();
    expect(s.sampleXY(50, 500)).toBeNull();
    expect(s.sampleXY(-50, 50)).toBeNull();
  });
  it('도엽이 하나뿐이어도, 많아도(10x10 장) 같은 값을 준다', () => {
    const tiles = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) tiles.push(make(i * 100 + (j % 3) * 2, (j + 1) * 100, 10, 10, 10));
    const m = createMosaicSampler(tiles, (lon, lat) => [lon, lat]);
    expect(m.sampleXY(455, 355)).toBeCloseTo(810, 3); // 도엽 (4, 2) 안
    expect(createMosaicSampler([a], (lon, lat) => [lon, lat]).sampleXY(25, 75)).toBeCloseTo(100, 6);
    expect(() => createMosaicSampler([], (lon, lat) => [lon, lat])).toThrow();
  });
});
