import { describe, expect, it } from 'vitest';
import { inspectGlb, readGlbJson } from './glbInspect.js';

/** 시험용 glb 만들기: JSON 청크만 있어도 우리가 읽는 부분은 충분하다 (BIN 청크는 비워 둔다) */
export function makeGlb(json) {
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(enc.length / 4) * 4).fill(0x20);
  padded.set(enc);
  const buf = new ArrayBuffer(12 + 8 + padded.length);
  const v = new DataView(buf);
  v.setUint32(0, 0x46546c67, true); // 'glTF'
  v.setUint32(4, 2, true);
  v.setUint32(8, buf.byteLength, true);
  v.setUint32(12, padded.length, true);
  v.setUint32(16, 0x4e4f534a, true); // 'JSON'
  new Uint8Array(buf, 20).set(padded);
  return buf;
}

const box = (min, max, count = 36) => ({ componentType: 5126, type: 'VEC3', count, min, max });

describe('inspectGlb 기본 정보', () => {
  it('glb가 아니면 null', () => {
    expect(inspectGlb(new ArrayBuffer(40))).toBeNull();
    expect(readGlbJson(new ArrayBuffer(4))).toBeNull();
  });

  it('범위, 삼각형 수, 개수를 구한다', () => {
    const glb = makeGlb({
      asset: { version: '2.0', generator: 'test-gen' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [box([-1, 0, -2], [3, 4, 2], 24), { componentType: 5123, type: 'SCALAR', count: 36 }],
      materials: [{}, {}],
    });
    const info = inspectGlb(glb);
    expect(info.version).toBe('2.0');
    expect(info.generator).toBe('test-gen');
    expect(info.bounds).toEqual({ min: [-1, 0, -2], max: [3, 4, 2] });
    expect(info.size).toEqual([4, 4, 4]);
    expect(info.center).toEqual([1, 2, 0]);
    expect(info.triangles).toBe(12);
    expect(info.counts).toMatchObject({ nodes: 1, meshes: 1, materials: 2 });
    expect(info.detected).toBeNull();
  });

  it('노드 변환(이동·배율)을 범위에 반영한다', () => {
    const glb = makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ translation: [10, 0, 0], scale: [2, 2, 2], children: [1] }, { mesh: 0, translation: [0, 5, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [box([0, 0, 0], [1, 1, 1], 36)],
    });
    const info = inspectGlb(glb);
    // 자식(0,5,0 이동) 후 부모(2배, +10 이동): x 10..12, y 10..12, z 0..2
    expect(info.bounds.min).toEqual([10, 10, 0]);
    expect(info.bounds.max).toEqual([12, 12, 2]);
  });

  it('인덱스가 없으면 정점 수로 삼각형 수를 센다', () => {
    const glb = makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [box([0, 0, 0], [1, 1, 1], 30)],
    });
    expect(inspectGlb(glb).triangles).toBe(10);
  });

  it('노드가 서로를 참조하는 잘못된 파일에서도 멈추지 않는다', () => {
    const glb = makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ children: [1] }, { children: [0], mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [box([0, 0, 0], [1, 1, 1])],
    });
    expect(inspectGlb(glb).bounds).not.toBeNull();
  });

  it('POSITION의 min/max가 없으면 범위를 모르고 경고한다', () => {
    const glb = makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ componentType: 5126, type: 'VEC3', count: 3 }],
    });
    const info = inspectGlb(glb);
    expect(info.bounds).toBeNull();
    expect(info.warnings.join(' ')).toMatch(/범위를 파일에서 알 수 없/);
  });
});

describe('압축 확장 판별', () => {
  it('Draco/KTX2/Meshopt 사용 여부를 알려 준다', () => {
    const info = inspectGlb(
      makeGlb({
        asset: { version: '2.0' },
        extensionsUsed: ['KHR_draco_mesh_compression', 'KHR_texture_basisu'],
        extensionsRequired: ['KHR_draco_mesh_compression'],
      }),
    );
    expect(info.needs).toEqual({ draco: true, ktx2: true, meshopt: false });
  });

  it('확장이 없으면 모두 false', () => {
    expect(inspectGlb(makeGlb({ asset: { version: '2.0' } })).needs).toEqual({ draco: false, ktx2: false, meshopt: false });
  });
});

describe('좌표 자동 판별', () => {
  const ecefCenter = [-3.5e6, 4.1e6, 3.6e6]; // 크기 약 6.4e6

  it('CESIUM_RTC center가 지구 좌표면 rtc 후보', () => {
    const info = inspectGlb(makeGlb({ asset: { version: '2.0' }, extensions: { CESIUM_RTC: { center: ecefCenter } } }));
    expect(info.detected).toEqual({ kind: 'rtc', center: ecefCenter });
  });

  it('CESIUM_RTC center가 지구 좌표가 아니면 쓰지 않고 경고', () => {
    const info = inspectGlb(makeGlb({ asset: { version: '2.0' }, extensions: { CESIUM_RTC: { center: [1, 2, 3] } } }));
    expect(info.detected).toBeNull();
    expect(info.warnings.join(' ')).toMatch(/CESIUM_RTC/);
  });

  it('정점 좌표가 지구 반경 규모면 ecef 후보', () => {
    const glb = makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [box([-3.5e6, 4.1e6, 3.6e6], [-3.5e6 + 10, 4.1e6 + 10, 3.6e6 + 10])],
    });
    expect(inspectGlb(glb).detected).toEqual({ kind: 'ecef' });
  });

  it('일반 로컬 좌표 모델은 판별되지 않는다', () => {
    const glb = makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [box([0, 0, 0], [10, 5, 10])],
    });
    expect(inspectGlb(glb).detected).toBeNull();
  });
});

describe('단위/형식 경고', () => {
  const sized = (max) =>
    makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [box([0, 0, 0], [max, 1, 1])],
    });

  it('아주 큰 모델은 단위(mm/cm)를 확인하라고 안내', () => {
    expect(inspectGlb(sized(50000)).warnings.join(' ')).toMatch(/mm\/cm/);
  });

  it('아주 작은 모델은 단위(km)를 확인하라고 안내', () => {
    const w = inspectGlb(makeGlb({
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [box([0, 0, 0], [0.01, 0.01, 0.01])],
    })).warnings.join(' ');
    expect(w).toMatch(/매우 작습니다/);
  });

  it('보통 크기에는 경고가 없다', () => {
    expect(inspectGlb(sized(30)).warnings).toEqual([]);
  });

  it('외부 .bin을 참조하는 파일은 읽을 수 없다고 안내', () => {
    const info = inspectGlb(makeGlb({ asset: { version: '2.0' }, buffers: [{ uri: 'model.bin', byteLength: 10 }] }));
    expect(info.warnings.join(' ')).toMatch(/외부 파일/);
  });
});
