import { describe, expect, it } from 'vitest';
import { UnsupportedGeometry, parseGpkgGeometry, parseWkb, readGpkgHeader } from './gpkgGeometry.js';
import { toGpkgBlob, toWkb } from './gpkgFixture.js';

const roundTrip = (g, opts) => parseGpkgGeometry(toGpkgBlob(g, 5186, opts));

describe('GeoPackage 도형 해석', () => {
  const shapes = {
    점: { type: 'Point', coordinates: [127.1, 37.5] },
    선: { type: 'LineString', coordinates: [[0, 0], [1, 2], [3, 1]] },
    면_구멍: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 2]]] },
    멀티점: { type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] },
    멀티선: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[5, 5], [6, 7]]] },
    멀티면: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] },
    묶음: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2] }, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }] },
  };

  for (const [name, g] of Object.entries(shapes)) {
    it(`${name}: 쓴 그대로 읽는다`, () => {
      expect(roundTrip(g).geometry).toEqual(g);
      expect(roundTrip(g).srsId).toBe(5186);
    });
  }

  it('범위(envelope)가 있어도, 머리글이 big endian 이어도 읽는다', () => {
    const g = shapes.선;
    expect(roundTrip(g, { envelopeXY: true }).geometry).toEqual(g);
    expect(roundTrip(g, { bigEndianHeader: true }).srsId).toBe(5186);
    expect(roundTrip(g, { bigEndianHeader: true }).geometry).toEqual(g);
  });

  it('높이(Z)는 세 번째 좌표로 남긴다', () => {
    const g = { type: 'LineString', coordinates: [[1, 2, 30], [4, 5, 60]] };
    expect(roundTrip(g, { z: true }).geometry).toEqual(g);
    expect(roundTrip({ type: 'Point', coordinates: [1, 2, 9] }, { z: true }).geometry.coordinates).toEqual([1, 2, 9]);
  });

  it('M 값은 버리고, 확장(EWKB) 방식의 Z 표시도 읽는다', () => {
    // ISO PointM(2001): x, y, m
    const m = new DataView(new ArrayBuffer(5 + 24));
    m.setUint8(0, 1);
    m.setUint32(1, 2001, true);
    [1, 2, 99].forEach((v, i) => m.setFloat64(5 + i * 8, v, true));
    expect(parseWkb(new Uint8Array(m.buffer)).coordinates).toEqual([1, 2]);
    // EWKB: 0x80000000 | 1 = 점 + Z
    const z = new DataView(new ArrayBuffer(5 + 24));
    z.setUint8(0, 1);
    z.setUint32(1, 0x80000001, true);
    [1, 2, 3].forEach((v, i) => z.setFloat64(5 + i * 8, v, true));
    expect(parseWkb(new Uint8Array(z.buffer)).coordinates).toEqual([1, 2, 3]);
  });

  it('빈 도형은 null: 빈 표시, 좌표가 NaN 인 점', () => {
    expect(parseGpkgGeometry(toGpkgBlob(null, 4326)).geometry).toBeNull();
    expect(roundTrip({ type: 'Point', coordinates: [NaN, NaN] }).geometry).toBeNull();
  });

  it('곡선 도형은 지원하지 않는다고 종류를 알려 준다', () => {
    const b = new DataView(new ArrayBuffer(9));
    b.setUint8(0, 1);
    b.setUint32(1, 8, true); // CircularString
    b.setUint32(5, 0, true);
    try {
      parseWkb(new Uint8Array(b.buffer));
      throw new Error('오류가 나야 한다');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedGeometry);
      expect(e.typeName).toBe('CircularString');
    }
  });

  it('GP 가 아니거나 잘린 데이터는 오류', () => {
    expect(() => readGpkgHeader(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/GP/);
    const blob = toGpkgBlob(shapes.선, 4326);
    expect(() => parseGpkgGeometry(blob.slice(0, blob.length - 5))).toThrow(/잘렸/);
  });

  it('toWkb 는 만들 수 없는 종류를 거절한다', () => {
    expect(() => toWkb({ type: 'Circle' })).toThrow();
  });
});
