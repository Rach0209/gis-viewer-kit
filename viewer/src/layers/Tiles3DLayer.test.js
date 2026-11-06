import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Tiles3DLayer } from './Tiles3DLayer.js';

describe('Tiles3DLayer load-error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an error identifying the layer and the failed url', () => {
    // 실제 TilesRenderer/네트워크 없이, 핸들러 로직만 직접 호출해서 검증한다
    // (onAdd는 WebGLRenderer가 필요한 Viewer를 요구하므로 여기서는 우회).
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const layer = new Tiles3DLayer({ id: 'my-tileset', tilesetUrl: 'https://example.com/tileset.json' });

    const fakeError = new Error('Failed to fetch');
    layer._onLoadError({ tile: null, error: fakeError, url: 'https://example.com/tileset.json' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('my-tileset');
    expect(errorSpy.mock.calls[0][0]).toContain('https://example.com/tileset.json');
    expect(errorSpy.mock.calls[0][1]).toBe(fakeError);
  });
});

describe('Tiles3DLayer.getBoundingBox', () => {
  // 회귀 테스트: getBoundingBox()가 tiles.group.matrix(placement:'geo'일 때
  // applyGeoTransform이 설정하는 ECEF->로컬 재배치 행렬)를 반영하지 않으면,
  // 실제 ECEF 데이터에서 카메라가 지구 중심 근처의 수백만 단위 좌표로 튀는 버그가 생긴다
  // (2026-08-05 실제 데이터 연동 중 발견).
  it("applies tiles.group.matrix so the box lands in this layer's local space, not raw ECEF/tileset space", () => {
    const layer = new Tiles3DLayer({ id: 'test', tilesetUrl: 'https://example.com/tileset.json' });

    // tiles.getBoundingBox(target)는 "group의 로컬 공간" 기준 박스를 target에 채워 넣고
    // true를 반환한다 -- 실제 TilesRenderer의 계약을 흉내 낸 가짜 객체.
    const rawMin = new THREE.Vector3(-1, -1, -1);
    const rawMax = new THREE.Vector3(1, 1, 1);
    layer._tiles = {
      getBoundingBox: (target) => {
        target.min.copy(rawMin);
        target.max.copy(rawMax);
        return true;
      },
      group: { matrix: new THREE.Matrix4().makeTranslation(100, 200, 300) },
    };

    const box = layer.getBoundingBox();

    expect(box.min.toArray()).toEqual([99, 199, 299]);
    expect(box.max.toArray()).toEqual([101, 201, 301]);
  });

  it('returns null when the tileset has not loaded yet', () => {
    const layer = new Tiles3DLayer({ id: 'test', tilesetUrl: 'https://example.com/tileset.json' });
    layer._tiles = { getBoundingBox: () => false, group: { matrix: new THREE.Matrix4() } };

    expect(layer.getBoundingBox()).toBeNull();
  });

  it('returns null before onAdd has run at all', () => {
    const layer = new Tiles3DLayer({ id: 'test', tilesetUrl: 'https://example.com/tileset.json' });
    expect(layer.getBoundingBox()).toBeNull();
  });
});
