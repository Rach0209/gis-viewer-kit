import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isVisibleInHierarchy, pickAt } from './Raycast.js';
import { PickableRegistry } from './PickableRegistry.js';

function setup() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const domElement = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  const registry = new PickableRegistry();
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  group.add(mesh);
  group.updateMatrixWorld(true);
  registry.register(mesh, { note: 'a' }, 'layer');
  return { ctx: { camera, domElement, registry }, group, mesh };
}

describe('pickAt', () => {
  it('보이는 메시는 맞는다', () => {
    const { ctx, mesh } = setup();
    expect(pickAt(50, 50, ctx)?.object).toBe(mesh);
  });

  it('레이어(조상)를 끄면 맞지 않는다', () => {
    const { ctx, group } = setup();
    group.visible = false;
    expect(pickAt(50, 50, ctx)).toBeNull();
  });

  it('앞의 것이 꺼져 있으면 그 뒤의 보이는 것이 맞는다', () => {
    const { ctx, mesh } = setup();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    back.position.z = -1;
    back.updateMatrixWorld(true);
    ctx.registry.register(back, {}, 'layer2');
    mesh.visible = false;
    expect(pickAt(50, 50, ctx)?.object).toBe(back);
  });
});

describe('isVisibleInHierarchy', () => {
  it('조상 중 하나라도 꺼져 있으면 false', () => {
    const a = new THREE.Group();
    const b = new THREE.Group();
    const c = new THREE.Object3D();
    a.add(b);
    b.add(c);
    expect(isVisibleInHierarchy(c)).toBe(true);
    a.visible = false;
    expect(isVisibleInHierarchy(c)).toBe(false);
  });
});
