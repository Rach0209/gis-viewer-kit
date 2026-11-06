import { describe, expect, it } from 'vitest';
import { dirOfEntry, extentFromAvailable, findLayerJson, summarizeLayerJson, terrainTilesInfoRows } from './terrainTilesCore.js';

describe('findLayerJson / dirOfEntry', () => {
  it('가장 얕은 layer.json (대소문자 무시)', () => {
    expect(findLayerJson(['a/b/layer.json', 'layer.json', 'x/layer.json'])).toBe('layer.json');
    expect(findLayerJson(['지형/Layer.JSON', '지형/0/0/0.terrain'])).toBe('지형/Layer.JSON');
    expect(findLayerJson(['a.glb'])).toBeUndefined();
  });
  it('폴더 경로', () => {
    expect(dirOfEntry('layer.json')).toBe('');
    expect(dirOfEntry('a/b/layer.json')).toBe('a/b');
  });
});

describe('summarizeLayerJson', () => {
  it('Cesium이 만든 전형적인 layer.json', () => {
    const s = summarizeLayerJson({
      tilejson: '2.1.0',
      name: 'korea',
      format: 'quantized-mesh-1.0',
      version: '1.2.0',
      scheme: 'tms',
      tiles: ['{z}/{x}/{y}.terrain?v={version}'],
      projection: 'EPSG:4326',
      bounds: [124.5, 33.1, 131.9, 38.6],
      minzoom: 0,
      maxzoom: 14,
      extensions: ['octvertexnormals', 'watermask'],
      available: [[{ startX: 0, endX: 1, startY: 0, endY: 0 }]],
    });
    expect(s).toMatchObject({ name: 'korea', format: 'quantized-mesh-1.0', minzoom: 0, maxzoom: 14, bounds: [124.5, 33.1, 131.9, 38.6], scheme: 'tms', projection: 'EPSG:4326' });
    expect(s.extensions).toEqual(['octvertexnormals', 'watermask']);
    expect(s.tiles[0]).toContain('{z}');
  });
  it('잘못된 bounds는 null, maxzoom이 없으면 available 길이로', () => {
    expect(summarizeLayerJson({ bounds: [10, 10, 5, 5] }).bounds).toBeNull();
    expect(summarizeLayerJson({ bounds: [0, 0, 400, 5] }).bounds).toBeNull();
    expect(summarizeLayerJson({ available: [[], [], []] }).maxzoom).toBe(2);
  });
  it('이상한 입력에도 기본값', () => {
    const s = summarizeLayerJson(null);
    expect(s).toMatchObject({ name: '', format: '', scheme: 'tms', projection: 'EPSG:4326', bounds: null, minzoom: null, maxzoom: null });
  });
});

describe('extentFromAvailable (실제 타일이 있는 지역)', () => {
  // 실제로 있었던 모양: bounds 는 동반구 전체로 대충 적혀 있고, 실제 타일은 레벨 16에 약 0.5도 크기의 한 지역에만 있다
  const roughBounds = {
    scheme: 'tms',
    projection: 'EPSG:4326',
    bounds: [0, -90, 180, 90],
    available: [
      [{ startX: 1, startY: 0, endX: 1, endY: 0 }],
      ...Array.from({ length: 15 }, () => []),
      [{ startX: 111900, startY: 46450, endX: 112100, endY: 46600 }],
    ],
  };
  it('가장 높은 레벨의 범위에서 지역을 구한다 (한반도 중부 부근의 예)', () => {
    const e = extentFromAvailable(roughBounds);
    expect(e[0]).toBeCloseTo(-180 + 111900 * (180 / 2 ** 16), 6);
    expect(e[2]).toBeCloseTo(-180 + 112101 * (180 / 2 ** 16), 6);
    expect(e[0]).toBeGreaterThan(127);
    expect(e[2]).toBeLessThan(128.5);
    expect(e[1]).toBeGreaterThan(37.5);
    expect(e[3]).toBeLessThan(38.5);
  });
  it('요약의 extent 는 실제 타일 지역, bounds 는 적힌 그대로', () => {
    const s = summarizeLayerJson(roughBounds);
    expect(s.bounds).toEqual([0, -90, 180, 90]);
    expect(s.extent[0]).toBeGreaterThan(127);
    const rows = Object.fromEntries(terrainTilesInfoRows({ summary: s, fileCount: 1, hasNormals: false, hasWaterMask: false }));
    expect(rows['범위(타일이 있는 곳)']).toContain('127.');
    expect(rows['layer.json bounds']).toContain('훨씬 넓게');
  });
  it('slippyMap(y가 북쪽부터)이면 위아래가 뒤집힌다', () => {
    const a = extentFromAvailable({ projection: 'EPSG:4326', scheme: 'slippyMap', available: [[], [], [{ startX: 5, endX: 5, startY: 0, endY: 0 }]] });
    expect(a[3]).toBeCloseTo(90, 6); // 북쪽 끝 타일
    const t = extentFromAvailable({ projection: 'EPSG:4326', scheme: 'tms', available: [[], [], [{ startX: 5, endX: 5, startY: 0, endY: 0 }]] });
    expect(t[1]).toBeCloseTo(-90, 6); // 남쪽 끝 타일
  });
  it('없거나 지원하지 않는 투영이면 null, 이때 extent 는 bounds', () => {
    expect(extentFromAvailable({})).toBeNull();
    expect(extentFromAvailable({ projection: 'EPSG:3857', available: [[{ startX: 0, endX: 0, startY: 0, endY: 0 }]] })).toBeNull();
    expect(summarizeLayerJson({ bounds: [124, 33, 131, 38] }).extent).toEqual([124, 33, 131, 38]);
  });
});

it('정보 목록: 범위 없으면 그 사실을 알린다', () => {
  const rows = terrainTilesInfoRows({ summary: summarizeLayerJson({ format: 'heightmap-1.0' }), fileCount: 1234, hasNormals: false, hasWaterMask: false });
  const map = Object.fromEntries(rows);
  expect(map['형식']).toContain('heightmap-1.0');
  expect(map['범위']).toContain('가 없어');
  expect(map['폴더 안 파일']).toBe('1,234개');
  expect(map['법선(음영용)']).toBe('없음');
});
