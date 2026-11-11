import { describe, expect, it } from 'vitest';
import { describePlacement, geometryToWkt, lonLatOfPlacement, safeFileName, toCsvText, toGeoJsonText } from './exportData.js';
import { fromLonLat } from '../../viewer/src/kit/crsList.js';

const points = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [127, 38] }, properties: { 이름: '가', 값: 1.5 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [127.1, 38.1] }, properties: { 이름: '나, "따옴표"', 메모: { a: 1 } } },
  ],
};
const mixed = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[127, 38], [127.1, 38.1, 50]] }, properties: { id: 1 } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[127, 38], [127.1, 38], [127.1, 38.1], [127, 38]]] }, properties: { id: 2 } },
  ],
};

describe('toGeoJsonText', () => {
  it('기본은 WGS84 그대로 (crs 항목 없음)', () => {
    const o = JSON.parse(toGeoJsonText(points));
    expect(o.crs).toBeUndefined();
    expect(o.features[0].geometry.coordinates).toEqual([127, 38]);
  });
  it('다른 좌표계를 고르면 좌표를 바꾸고 crs 항목을 붙인다 (5186: 127E 38N = 200000, 600000)', () => {
    const o = JSON.parse(toGeoJsonText(points, { crs: 'EPSG:5186' }));
    expect(o.crs).toEqual({ type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::5186' } });
    expect(o.features[0].geometry.coordinates[0]).toBeCloseTo(200000, 3);
    expect(o.features[0].geometry.coordinates[1]).toBeCloseTo(600000, 3);
    expect(o.features[0].properties).toEqual(points.features[0].properties);
  });
  it('높이 같은 세 번째 값은 유지한다', () => {
    const o = JSON.parse(toGeoJsonText(mixed, { crs: 'EPSG:5186' }));
    expect(o.features[0].geometry.coordinates[1][2]).toBe(50);
  });
  it('모르는 좌표계는 오류', () => {
    expect(() => toGeoJsonText(points, { crs: 'EPSG:9999' })).toThrow(/지원하지 않는/);
  });
  it('원본 자료를 바꾸지 않는다', () => {
    toGeoJsonText(points, { crs: 'EPSG:5186' });
    expect(points.features[0].geometry.coordinates).toEqual([127, 38]);
  });
});

describe('geometryToWkt', () => {
  it.each([
    [{ type: 'Point', coordinates: [1, 2, 3] }, 'POINT (1 2)'],
    [{ type: 'LineString', coordinates: [[1, 2], [3, 4]] }, 'LINESTRING (1 2, 3 4)'],
    [{ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0.2, 0.2], [0.4, 0.2], [0.2, 0.4], [0.2, 0.2]]] }, 'POLYGON ((0 0, 1 0, 1 1, 0 0), (0.2 0.2, 0.4 0.2, 0.2 0.4, 0.2 0.2))'],
    [{ type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] }, 'MULTIPOINT ((1 2), (3 4))'],
    [{ type: 'MultiLineString', coordinates: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]] }, 'MULTILINESTRING ((1 2, 3 4), (5 6, 7 8))'],
    [{ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] }, 'MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)))'],
    [null, ''],
  ])('%j', (g, wkt) => {
    expect(geometryToWkt(g)).toBe(wkt);
  });
});

describe('toCsvText', () => {
  it('점만 있으면 경도·위도 열 + 속성, 앞에 BOM, 쉼표·따옴표·객체는 안전하게', () => {
    const t = toCsvText(points);
    expect(t.charCodeAt(0)).toBe(0xfeff);
    const lines = t.slice(1).split('\r\n');
    expect(lines[0]).toBe('경도,위도,이름,값,메모');
    expect(lines[1]).toBe('127,38,가,1.5,');
    expect(lines[2]).toBe('127.1,38.1,"나, ""따옴표""",,"{""a"":1}"');
  });
  it('다른 좌표계면 X·Y 열이 더해진다', () => {
    const lines = toCsvText(points, { crs: 'EPSG:5186', bom: false }).split('\r\n');
    expect(lines[0]).toBe('경도,위도,X(EPSG:5186),Y(EPSG:5186),이름,값,메모');
    const cells = lines[1].split(',');
    expect(Number(cells[2])).toBeCloseTo(200000, 2);
    expect(Number(cells[3])).toBeCloseTo(600000, 2);
  });
  it('선·면이 섞이면 WKT 열', () => {
    const lines = toCsvText(mixed, { bom: false }).split('\r\n');
    expect(lines[0]).toBe('WKT,id');
    expect(lines[1]).toBe('"LINESTRING (127 38, 127.1 38.1)",1');
    expect(lines[2].startsWith('"POLYGON ((127 38')).toBe(true);
  });
  it('WKT 도 고른 좌표계로', () => {
    const lines = toCsvText(mixed, { crs: 'EPSG:5186', bom: false }).split('\r\n');
    expect(lines[0]).toBe('WKT(EPSG:5186),id');
    expect(lines[1]).toContain('LINESTRING (200000 600000');
  });
  it('피처가 없으면 머리글만', () => {
    expect(toCsvText({ features: [] }, { bom: false })).toBe('WKT\r\n');
  });
});

describe('safeFileName', () => {
  it('확장자를 바꾸고 금지 문자를 치환', () => {
    expect(safeFileName('도로.shp', 'geojson')).toBe('도로.geojson');
    expect(safeFileName('a/b:c?.zip', 'csv')).toBe('a_b_c_.csv');
    expect(safeFileName('', 'csv')).toBe('data.csv');
  });
});

describe('describePlacement', () => {
  const meta = { lon: 127, lat: 38, height: 12.3456, headingDeg: 30, pitchDeg: 0, rollDeg: 0, scale: 2, upAxis: 'Z' };
  it('고른 좌표계의 X·Y 와 나머지 값을 글·JSON 으로', () => {
    const d = describePlacement(meta, 'EPSG:5186');
    expect(d.place.x).toBeCloseTo(200000, 2);
    expect(d.place.y).toBeCloseTo(600000, 2);
    expect(d.place).toMatchObject({ crs: 'EPSG:5186', height: 12.346, headingDeg: 30, scale: 2, upAxis: 'Z' });
    expect(d.text).toContain('X (동쪽, m): 200000');
    expect(JSON.parse(d.json).crs).toBe('EPSG:5186');
    expect(d.xyText).toMatch(/^200000(\.\d+)?, 600000(\.\d+)?$/);
  });
  it('경위도(4326)는 경도·위도를 그대로', () => {
    expect(describePlacement(meta, 'EPSG:4326').place).toMatchObject({ x: 127, y: 38 });
  });
  it('JSON 에서 경위도를 되읽는다 (경위도 값이 없어도 좌표계로 되돌린다)', () => {
    const p = fromLonLat('EPSG:5186', 127.01, 38.02);
    const back = lonLatOfPlacement({ crs: 'EPSG:5186', x: p.x, y: p.y });
    expect(back.lon).toBeCloseTo(127.01, 6);
    expect(back.lat).toBeCloseTo(38.02, 6);
    expect(lonLatOfPlacement({ lon: 1, lat: 2 })).toEqual({ lon: 1, lat: 2 });
  });
});
