import { describe, expect, it } from 'vitest';
import { PROVIDERS, bboxFromPoints, chooseZoom, resolveProvider, tileUrl } from './rasterProviders.js';

describe('resolveProvider', () => {
  it('osm은 키 없이 쓸 수 있다', () => {
    const p = resolveProvider('osm');
    expect(p.urlTemplate).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(p.attribution).toMatch(/OpenStreetMap/);
  });

  it('vworld는 키가 있어야 하고, 주소 순서는 z/y/x 이다', () => {
    expect(() => resolveProvider('vworld-base')).toThrow(/API 키/);
    const p = resolveProvider('vworld-base', 'ABC-123');
    expect(p.urlTemplate).toBe('https://api.vworld.kr/req/wmts/1.0.0/ABC-123/Base/{z}/{y}/{x}.png');
    expect(tileUrl(p.urlTemplate, { z: 15, x: 27000, y: 12700 })).toBe(
      'https://api.vworld.kr/req/wmts/1.0.0/ABC-123/Base/15/12700/27000.png',
    );
  });

  it('키는 주소에 안전하게 인코딩된다', () => {
    expect(resolveProvider('vworld-satellite', 'a/b c').urlTemplate).toContain('/a%2Fb%20c/Satellite/');
  });

  it('직접 만든 정의도 받는다', () => {
    const p = resolveProvider({ urlTemplate: 'https://t.example/{z}/{x}/{y}.png', maxZoom: 17, attribution: 'x' });
    expect(p.maxZoom).toBe(17);
  });

  it('알 수 없는 공급자는 오류', () => {
    expect(() => resolveProvider('nope')).toThrow(/알 수 없는/);
  });

  it('모든 내장 공급자 정의가 필요한 항목을 갖는다', () => {
    for (const [id, p] of Object.entries(PROVIDERS)) {
      expect(p.urlTemplate, id).toContain('{z}');
      expect(p.attribution, id).not.toBe('');
    }
  });
});

describe('tileUrl', () => {
  it('z/x/y를 채운다', () => {
    expect(tileUrl('https://t/{z}/{x}/{y}.png', { z: 3, x: 4, y: 5 })).toBe('https://t/3/4/5.png');
  });
});

describe('bboxFromPoints', () => {
  it('점들을 감싸고 여유를 더한다', () => {
    const b = bboxFromPoints([{ lon: 128.3, lat: 36.1 }, { lon: 128.4, lat: 36.2 }], 0.1);
    expect(b.west).toBeCloseTo(128.29, 5);
    expect(b.east).toBeCloseTo(128.41, 5);
    expect(b.south).toBeCloseTo(36.09, 5);
    expect(b.north).toBeCloseTo(36.21, 5);
  });

  it('점이 한 곳이어도 최소한의 폭을 갖는다', () => {
    const b = bboxFromPoints([{ lon: 128, lat: 36 }]);
    expect(b.east).toBeGreaterThan(b.west);
    expect(b.north).toBeGreaterThan(b.south);
  });
});

describe('chooseZoom', () => {
  // 실데이터와 비슷한 크기: 약 7.6km x 5.8km
  const bbox = bboxFromPoints([{ lon: 126.937, lat: 37.54 }, { lon: 127.023, lat: 37.592 }]);

  it('타일 수 한도 안에서 가장 높은 줌을 고른다', () => {
    const { zoom, count } = chooseZoom(bbox, { maxTiles: 64 });
    expect(count).toBeLessThanOrEqual(64);
    expect(chooseZoom(bbox, { maxTiles: 64, maxZoom: zoom + 1 }).zoom).toBe(zoom); // 한 단계 더 높이면 한도 초과라 같은 값
    expect(zoom).toBeGreaterThanOrEqual(13);
    expect(zoom).toBeLessThanOrEqual(16);
  });

  it('한도를 늘리면 더 선명한 줌을 고른다', () => {
    expect(chooseZoom(bbox, { maxTiles: 400 }).zoom).toBeGreaterThan(chooseZoom(bbox, { maxTiles: 40 }).zoom);
  });

  it('공급자의 최대 줌을 넘지 않는다', () => {
    const tiny = bboxFromPoints([{ lon: 128, lat: 36 }, { lon: 128.0001, lat: 36.0001 }]);
    expect(chooseZoom(tiny, { maxZoom: 17 }).zoom).toBe(17);
  });

  it('너무 넓으면 최소 줌까지 내려간다', () => {
    const wide = { west: -170, east: 170, south: -80, north: 80 };
    expect(chooseZoom(wide, { maxTiles: 4, minZoom: 2 }).zoom).toBe(2);
  });
});
