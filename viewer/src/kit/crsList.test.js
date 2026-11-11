import { describe, expect, it } from 'vitest';
import { CRS_LIST, DEFAULT_CRS, crsInfoFromDef, customCrsList, fromLonLat, getCrs, isKnownCrs, isNearKorea, isValidLonLat, registerCrs, toLonLat } from './crsList.js';

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

  it('모든 좌표계에서 경위도 -> 좌표 -> 경위도 왕복 오차가 작다 (측지계 변환이 있는 베셀은 6자리, 나머지는 9자리)', () => {
    for (const c of CRS_LIST) {
      const digits = c.def?.includes('towgs84') ? 6 : 9;
      const p = fromLonLat(c.code, 126.978, 37.5665);
      const g = toLonLat(c.code, p.x, p.y);
      expect(g.lon).toBeCloseTo(126.978, digits);
      expect(g.lat).toBeCloseTo(37.5665, digits);
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

describe('목록 확대 (한국 좌표계 + UTM)', () => {
  it.each([
    ['EPSG:5188', 131, 200000, 600000],
    ['EPSG:5181', 127, 200000, 500000],
    ['EPSG:5180', 125, 200000, 500000],
    ['EPSG:5183', 129, 200000, 500000],
  ])('%s: 중앙자오선 %sE, 38N 은 (%s, %s)', (code, lon0, x, y) => {
    const p = fromLonLat(code, lon0, 38);
    expect(p.x).toBeCloseTo(x, 3);
    expect(p.y).toBeCloseTo(y, 3);
  });

  it('5174 베셀은 5181(같은 거짓 원점)과 수십~수백 m 차이 (측지계 차이)이고 왕복은 맞는다', () => {
    const a = fromLonLat('EPSG:5174', 127, 37.5);
    const b = fromLonLat('EPSG:5181', 127, 37.5);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(1000);
    const g = toLonLat('EPSG:5174', a.x, a.y);
    expect(g.lon).toBeCloseTo(127, 6);
    expect(g.lat).toBeCloseTo(37.5, 6);
  });

  it('UTM 존은 목록에 없어도 코드만으로 쓴다 (해외 GPS 자료)', () => {
    expect(isKnownCrs('EPSG:32633')).toBe(true);
    const p = fromLonLat('EPSG:32633', 15, 0); // 33N 의 중앙자오선(15E) 적도
    expect(p.x).toBeCloseTo(500000, 3);
    expect(p.y).toBeCloseTo(0, 3);
    const s = fromLonLat('EPSG:32733', 15, 0); // 남반구는 거짓 북쪽 10,000,000
    expect(s.y).toBeCloseTo(10000000, 3);
    expect(getCrs('EPSG:32633').label).toContain('UTM 33N');
  });

  it('UTM 존 범위를 벗어나면 모른다', () => {
    expect(isKnownCrs('EPSG:32661')).toBe(false);
    expect(isKnownCrs('EPSG:32600')).toBe(false);
  });
});

describe('registerCrs (직접 추가)', () => {
  const LAMBERT93 = '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs';

  it('PROJ 문자열로 추가하면 코드로 쓸 수 있다 (프랑스 Lambert-93: 3E, 46.5N 은 (700000, 6600000))', () => {
    const info = registerCrs({ code: 'EPSG:2154', def: LAMBERT93, label: '프랑스 Lambert-93' });
    expect(info).toMatchObject({ code: 'EPSG:2154', geographic: false, unit: 'm', custom: true });
    expect(isKnownCrs('EPSG:2154')).toBe(true);
    const p = fromLonLat('EPSG:2154', 3, 46.5);
    expect(p.x).toBeCloseTo(700000, 3);
    expect(p.y).toBeCloseTo(6600000, 3);
    expect(customCrsList().map((c) => c.code)).toContain('EPSG:2154');
  });

  it('경위도 좌표계(측지계가 다른 경우)는 정의대로 변환한다', () => {
    registerCrs({ code: 'EPSG:4301', def: '+proj=longlat +ellps=bessel +towgs84=-146.414,507.337,680.507,0,0,0,0 +no_defs', label: 'Tokyo' });
    const g = toLonLat('EPSG:4301', 139.7, 35.7);
    expect(g.lon).not.toBeCloseTo(139.7, 5);
    expect(Math.abs(g.lon - 139.7)).toBeLessThan(0.01);
    expect(getCrs('EPSG:4301').geographic).toBe(true);
  });

  it('피트 단위는 단위 이름을 붙인다', () => {
    const info = crsInfoFromDef('X:1', '+proj=tmerc +lat_0=0 +lon_0=-100 +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs');
    expect(info.unit).toBe('ft');
    expect(info.xLabel).toContain('ft');
  });

  it('해석할 수 없는 정의는 알아듣기 쉬운 오류', () => {
    expect(() => crsInfoFromDef('X:2', '이상한 글')).toThrow(/해석할 수 없습니다/);
  });
});
