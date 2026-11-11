import { describe, expect, it } from 'vitest';
import { hasHeights, shiftHeights, stripHeights } from './geomHeights.js';

const fc = (...geometries) => ({ type: 'FeatureCollection', features: geometries.map((geometry, i) => ({ type: 'Feature', properties: { i }, geometry })) });

describe('stripHeights', () => {
  const full = fc(
    { type: 'Point', coordinates: [127, 38, 30] },
    { type: 'LineString', coordinates: [[127, 38, 1], [127.1, 38.1, 2]] },
    { type: 'Polygon', coordinates: [[[127, 38, 0], [127.1, 38, 0], [127.1, 38.1, 0], [127, 38, 0]]] },
    { type: 'MultiPolygon', coordinates: [[[[0, 0, 5], [1, 0, 5], [1, 1, 5], [0, 0, 5]]]] },
    { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2, 3] }] },
  );

  it('모든 종류의 좌표에서 높이를 뗀다', () => {
    const out = stripHeights(full);
    expect(out.features[0].geometry.coordinates).toEqual([127, 38]);
    expect(out.features[1].geometry.coordinates).toEqual([[127, 38], [127.1, 38.1]]);
    expect(out.features[2].geometry.coordinates[0][1]).toEqual([127.1, 38]);
    expect(out.features[3].geometry.coordinates[0][0][0]).toEqual([0, 0]);
    expect(out.features[4].geometry.geometries[0].coordinates).toEqual([1, 2]);
    expect(out.features.map((f) => f.properties.i)).toEqual([0, 1, 2, 3, 4]);
  });

  it('원본은 바꾸지 않는다 (저장할 때 높이를 그대로 쓰도록)', () => {
    stripHeights(full);
    expect(full.features[0].geometry.coordinates).toEqual([127, 38, 30]);
    expect(full.features[1].geometry.coordinates[1]).toEqual([127.1, 38.1, 2]);
  });

  it('높이가 없으면 같은 객체를 돌려준다 (복사 비용 없음)', () => {
    const flat = fc({ type: 'Point', coordinates: [1, 2] }, { type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    expect(hasHeights(flat)).toBe(false);
    expect(stripHeights(flat)).toBe(flat);
  });

  it('geometry 가 없는 피처도 견딘다', () => {
    const c = fc({ type: 'Point', coordinates: [1, 2, 3] });
    c.features.push({ type: 'Feature', properties: {}, geometry: null });
    expect(stripHeights(c).features[1].geometry).toBeNull();
  });

  it('높이가 있는지 알아낸다', () => {
    expect(hasHeights(full)).toBe(true);
    expect(hasHeights(fc({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }))).toBe(false);
  });
});

describe('shiftHeights', () => {
  const pts = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [127, 38, 30] } }, { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[127, 38], [127.1, 38.1, 10]] } }] };

  it('높이가 있는 좌표에만 더하고, 높이가 없는 좌표에는 높이를 새로 만들지 않는다', () => {
    const out = shiftHeights(pts, 27);
    expect(out.features[0].geometry.coordinates).toEqual([127, 38, 57]);
    expect(out.features[1].geometry.coordinates).toEqual([[127, 38], [127.1, 38.1, 37]]);
  });
  it('0 이거나 높이가 없으면 같은 객체, 원본은 바뀌지 않는다', () => {
    expect(shiftHeights(pts, 0)).toBe(pts);
    const flat = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }] };
    expect(shiftHeights(flat, 10)).toBe(flat);
    shiftHeights(pts, 27);
    expect(pts.features[0].geometry.coordinates[2]).toBe(30);
  });
});
