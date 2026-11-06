import { describe, expect, it } from 'vitest';
import { coordLine, describeCoord, formatDistance, formatHeight } from './coordFormat.js';

describe('describeCoord', () => {
  it('경위도는 소수 6자리 도', () => {
    expect(describeCoord('EPSG:4326', 126.978, 37.5665)).toEqual({ xLabel: '경도', yLabel: '위도', x: '126.978000', y: '37.566500', unit: '°' });
  });
  it('중부원점(5186)의 원점(127E, 38N)은 (200000, 600000)', () => {
    const d = describeCoord('EPSG:5186', 127, 38);
    expect(d.x).toBe('200000.00');
    expect(d.y).toBe('600000.00');
    expect(d.unit).toBe('m');
  });
  it('통합(5179)의 원점(127.5E, 38N)은 (1000000, 2000000)', () => {
    const d = describeCoord('EPSG:5179', 127.5, 38);
    expect(d.x).toBe('1000000.00');
    expect(d.y).toBe('2000000.00');
  });
  it('모르는 좌표계는 오류', () => {
    expect(() => describeCoord('EPSG:1', 127, 38)).toThrow();
  });
});

it('coordLine', () => {
  expect(coordLine('EPSG:4326', 127, 37.5)).toBe('경도 127.000000°  위도 37.500000°');
  expect(coordLine('EPSG:5186', 127, 38)).toBe('X(동) 200000.00 m  Y(북) 600000.00 m');
});

describe('formatDistance', () => {
  it('작은 값은 m, 큰 값은 km', () => {
    expect(formatDistance(0)).toBe('0.00 m');
    expect(formatDistance(5.123)).toBe('5.12 m');
    expect(formatDistance(123.456)).toBe('123.5 m');
    expect(formatDistance(999.94)).toBe('999.9 m');
    expect(formatDistance(1500)).toBe('1.500 km');
    expect(formatDistance(250000)).toBe('250.00 km');
    expect(formatDistance(NaN)).toBe('–');
  });
});

it('formatHeight', () => {
  expect(formatHeight(12.345)).toBe('12.35 m');
  expect(formatHeight(undefined)).toBe('–');
  expect(formatHeight(-0.0004)).toBe('0.00 m');
  expect(formatHeight(-3.2)).toBe('-3.20 m');
});
