import { describe, it, expect } from 'vitest';
import { analyzeTileset, ecefToGeodetic } from './analyzeTileset.js';

// 지구 좌표(ECEF) 박스를 가진 타일셋의 루트 bounding box (시험용 값).
// 기대 위치: lon 126.978 / lat 37.5665 (서울 시청 부근).
const REAL_ROOT = {
  asset: { version: '1.1', tilesetVersion: 'example_1.0.0' },
  geometricError: 100000,
  root: {
    refine: 'ADD',
    boundingVolume: {
      box: [-3044827.648523094, 4043852.433221378, 3867477.9450575095, 3796.777308240067, 0, 0, 0, 2897.2466653436422, 0, 0, 0, 3479.2769663701765],
    },
    geometricError: 56250,
    children: [{}, {}],
  },
};

describe('ecefToGeodetic', () => {
  it('적도 본초 자오선 위의 점', () => {
    const g = ecefToGeodetic(6378137, 0, 0);
    expect(g.lon).toBeCloseTo(0, 9);
    expect(g.lat).toBeCloseTo(0, 9);
    expect(g.alt).toBeCloseTo(0, 3);
  });

  it('북극점은 위도 90, 고도 0', () => {
    const b = 6356752.314245; // WGS84 극반경
    const g = ecefToGeodetic(0, 0, b);
    expect(g.lat).toBeCloseTo(90, 6);
    expect(g.alt).toBeCloseTo(0, 2);
  });

  it('고도가 있는 점을 복원한다', () => {
    const g = ecefToGeodetic(6378137 + 1000, 0, 0);
    expect(g.alt).toBeCloseTo(1000, 3);
  });
});

describe('analyzeTileset', () => {
  it('ECEF box -> geo, 기존 수동 계산 origin과 일치', () => {
    const info = analyzeTileset(REAL_ROOT);
    expect(info.detectedMode).toBe('geo');
    expect(info.volumeType).toBe('box');
    expect(info.origin.lon).toBeCloseTo(126.978, 3);
    expect(info.origin.lat).toBeCloseTo(37.5665, 3);
    expect(info.origin.alt).toBe(0);
    expect(info.assetVersion).toBe('1.1');
    expect(info.tilesetVersion).toBe('example_1.0.0');
    expect(info.rootChildCount).toBe(2);
    expect(info.size[0]).toBeCloseTo(2 * 3796.777, 1);
    expect(info.modeReason).toMatch(/ECEF/);
  });

  it('작은 로컬 좌표 -> model', () => {
    const info = analyzeTileset({
      asset: { version: '1.0' },
      geometricError: 500,
      root: { boundingVolume: { box: [0, 0, 0, 50, 0, 0, 0, 50, 0, 0, 0, 10] }, children: [] },
    });
    expect(info.detectedMode).toBe('model');
    expect(info.origin).toBeNull();
  });

  it('region -> geo, 라디안을 도로 변환', () => {
    const rad = Math.PI / 180;
    const info = analyzeTileset({
      asset: { version: '1.0' },
      root: { boundingVolume: { region: [126 * rad, 36 * rad, 128 * rad, 38 * rad, 0, 200] } },
    });
    expect(info.detectedMode).toBe('geo');
    expect(info.origin.lon).toBeCloseTo(127, 6);
    expect(info.origin.lat).toBeCloseTo(37, 6);
    expect(info.centerAltitude).toBe(100);
  });

  it('root.transform이 있으면 중심에 적용해서 판별한다', () => {
    // 로컬 박스지만 transform이 ECEF 위치로 옮겨 놓는 경우 (이동 행렬, column-major)
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3044828, 4043852, 3867478, 1];
    const info = analyzeTileset({
      asset: { version: '1.0' },
      root: { transform: m, boundingVolume: { box: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10] } },
    });
    expect(info.hasRootTransform).toBe(true);
    expect(info.detectedMode).toBe('geo');
    expect(info.origin.lon).toBeCloseTo(126.98, 2);
  });

  it('필수 확장은 참고 경고로 알려준다', () => {
    const info = analyzeTileset({
      asset: { version: '1.1' },
      extensionsRequired: ['3DTILES_implicit_tiling'],
      root: { boundingVolume: { sphere: [0, 0, 0, 5] } },
    });
    expect(info.warnings.join(' ')).toMatch(/3DTILES_implicit_tiling/);
  });

  it('boundingVolume을 해석할 수 없으면 model + 경고', () => {
    const info = analyzeTileset({ asset: { version: '1.0' }, root: { boundingVolume: {} } });
    expect(info.detectedMode).toBe('model');
    expect(info.warnings.length).toBeGreaterThan(0);
  });

  it('tileset.json이 아니면 예외', () => {
    expect(() => analyzeTileset({})).toThrow(/tileset\.json/);
    expect(() => analyzeTileset(null)).toThrow();
  });
});
