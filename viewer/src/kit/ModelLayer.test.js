import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ModelLayer } from './ModelLayer.js';
import { PickableRegistry } from '../interaction/PickableRegistry.js';

function sampleScene() {
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial()); // 12 삼각형
  const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  b.position.set(10, 0, 0);
  g.add(a, b);
  return g;
}

const fakeViewer = () => ({ pickableRegistry: new PickableRegistry() });

describe('ModelLayer', () => {
  it('메시 개수와 삼각형 수를 센다', () => {
    const l = new ModelLayer({ id: 'm', scene: sampleScene(), matrix: new THREE.Matrix4() });
    expect(l.getStats()).toEqual({ meshes: 2, triangles: 24 });
  });

  it('배치 행렬을 적용한 범위를 돌려준다', () => {
    const l = new ModelLayer({ id: 'm', scene: sampleScene(), matrix: new THREE.Matrix4().makeTranslation(100, 50, 0) });
    const box = l.getBoundingBox();
    expect(box.min.x).toBeCloseTo(99);
    expect(box.max.x).toBeCloseTo(110.5);
    expect(box.min.y).toBeCloseTo(49);
  });

  it('배치 행렬에 크기가 있으면 범위도 그만큼 변한다', () => {
    const l = new ModelLayer({ id: 'm', scene: sampleScene(), matrix: new THREE.Matrix4().makeScale(0.5, 0.5, 0.5) });
    expect(l.getBoundingBox().getSize(new THREE.Vector3()).x).toBeCloseTo(5.75);
  });

  it('추가하면 모든 메시를 선택 가능 목록에 등록하고, 제거하면 해제한다', () => {
    const viewer = fakeViewer();
    const l = new ModelLayer({ id: 'm', scene: sampleScene(), matrix: new THREE.Matrix4() });
    l.onAdd(viewer);
    expect(viewer.pickableRegistry.getAll()).toHaveLength(2);
    expect(viewer.pickableRegistry.getMetadata(viewer.pickableRegistry.getAll()[0])).toMatchObject({ layerId: 'm' });
    l.onRemove(viewer);
    expect(viewer.pickableRegistry.getAll()).toHaveLength(0);
  });

  it('조명을 레이어 안에 둔다 (끌 수도 있다)', () => {
    const on = new ModelLayer({ id: 'a', scene: sampleScene(), matrix: new THREE.Matrix4() });
    on.onAdd(fakeViewer());
    const kinds = on.object3d.children.find((c) => c.name === 'model-lights').children.map((c) => c.type);
    expect(kinds).toContain('HemisphereLight');
    expect(kinds).toContain('DirectionalLight');
    const off = new ModelLayer({ id: 'b', scene: sampleScene(), matrix: new THREE.Matrix4(), lights: false });
    off.onAdd(fakeViewer());
    expect(off.object3d.children.find((c) => c.name === 'model-lights')).toBeUndefined();
  });

  it('onReady는 바로 범위를 알려 준다', () => {
    const l = new ModelLayer({ id: 'm', scene: sampleScene(), matrix: new THREE.Matrix4() });
    const cb = vi.fn();
    l.onReady(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].isBox3).toBe(true);
  });

  it('dispose는 지오메트리와 재질을 해제한다', () => {
    const scene = sampleScene();
    const geo = scene.children[0].geometry;
    const mat = scene.children[0].material;
    const gs = vi.spyOn(geo, 'dispose');
    const ms = vi.spyOn(mat, 'dispose');
    const l = new ModelLayer({ id: 'm', scene, matrix: new THREE.Matrix4() });
    l.dispose();
    expect(gs).toHaveBeenCalled();
    expect(ms).toHaveBeenCalled();
  });

  it('빈 장면이면 범위가 null', () => {
    const l = new ModelLayer({ id: 'm', scene: new THREE.Group(), matrix: new THREE.Matrix4() });
    expect(l.getBoundingBox()).toBeNull();
  });
});
