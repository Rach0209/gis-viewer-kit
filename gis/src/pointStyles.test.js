import { describe, expect, it } from 'vitest';
import { DEFAULT_POINT_STYLE, POINT_STYLES, hasPointGeometry, loadPointStyle, normalizePointStyle, pointStyleSpec, savePointStyle } from './pointStyles.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe('점 모양', () => {
  it('깔끔한 세 가지(동그라미·작은 점·핀)만 있고 핀이 기본', () => {
    expect(POINT_STYLES.map((p) => p.id)).toEqual(['circle', 'dot', 'pin']);
    expect(DEFAULT_POINT_STYLE).toBe('pin');
    expect(new Set(POINT_STYLES.map((p) => p.label)).size).toBe(3);
  });

  it('모르는 값은 기본 모양으로 바꾸고, 크기는 작은 점 < 동그라미', () => {
    expect(normalizePointStyle('star')).toBe('pin');
    expect(normalizePointStyle(undefined)).toBe('pin');
    expect(normalizePointStyle('circle')).toBe('circle');
    expect(pointStyleSpec('dot').size).toBeLessThan(pointStyleSpec('circle').size);
    expect(pointStyleSpec('없는값').id).toBe('pin');
  });

  it('점이 있는 자료에서만 고를 수 있다', () => {
    expect(hasPointGeometry(['Point'])).toBe(true);
    expect(hasPointGeometry(['Polygon', 'MultiPoint'])).toBe(true);
    expect(hasPointGeometry(['GeometryCollection'])).toBe(true);
    expect(hasPointGeometry(['Polygon', 'LineString'])).toBe(false);
    expect(hasPointGeometry([])).toBe(false);
    expect(hasPointGeometry(undefined)).toBe(false);
  });

  it('마지막으로 고른 모양을 기억하고, 저장소가 없거나 막혀도 기본값', () => {
    const s = memory();
    expect(loadPointStyle(s)).toBe('pin');
    savePointStyle('circle', s);
    expect(loadPointStyle(s)).toBe('circle');
    savePointStyle('이상한값', s);
    expect(loadPointStyle(s)).toBe('pin');
    expect(loadPointStyle(null)).toBe('pin');
    const blocked = { getItem: () => { throw new Error('막힘'); }, setItem: () => { throw new Error('막힘'); } };
    expect(loadPointStyle(blocked)).toBe('pin');
    expect(() => savePointStyle('dot', blocked)).not.toThrow();
  });
});
