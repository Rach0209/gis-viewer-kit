import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HoverHighlight } from './HoverHighlight.js';

/** 화면 100x100, 카메라가 원점의 큐브를 정면에서 보는 최소 환경 */
function makeEnv() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  mesh.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);

  const domElement = new EventTarget();
  domElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });

  const registered = new Set([mesh]);
  const updateCallbacks = [];
  const viewer = {
    camera,
    domElement,
    pickableRegistry: {
      getAll: () => [...registered],
      has: (o) => registered.has(o),
      getMetadata: () => ({}),
    },
    addUpdateCallback: (fn) => updateCallbacks.push(fn),
    removeUpdateCallback: (fn) => updateCallbacks.splice(updateCallbacks.indexOf(fn), 1),
  };
  const move = (x, y, buttons = 0) =>
    domElement.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: x, clientY: y, buttons }));
  return { mesh, viewer, move, registered, updateCallbacks };
}

describe('HoverHighlight', () => {
  it('커서 아래 메시를 강조하고, 벗어나면 원래 색으로 복원한다', () => {
    const { mesh, viewer, move } = makeEnv();
    const hover = new HoverHighlight({ color: 0x3aa0ff });
    hover.enable(viewer);
    const original = mesh.material.emissive.getHex();

    move(50, 50); // 화면 중앙 = 큐브
    expect(hover.hoveredObject).toBe(mesh);
    expect(mesh.material.emissive.getHex()).toBe(0x3aa0ff);

    move(2, 2); // 큐브 바깥
    expect(hover.hoveredObject).toBeNull();
    expect(mesh.material.emissive.getHex()).toBe(original);
  });

  it('드래그 중(버튼 누름)에는 강조를 쉰다', () => {
    const { mesh, viewer, move } = makeEnv();
    const hover = new HoverHighlight();
    hover.enable(viewer);
    move(50, 50);
    expect(hover.hoveredObject).toBe(mesh);
    move(50, 50, 1);
    expect(hover.hoveredObject).toBeNull();
  });

  it('레지스트리에서 빠진 객체의 강조는 다음 프레임에 풀린다 (동적 LOD)', () => {
    const { mesh, viewer, move, registered, updateCallbacks } = makeEnv();
    const hover = new HoverHighlight();
    hover.enable(viewer);
    move(50, 50);
    registered.delete(mesh);
    updateCallbacks.forEach((fn) => fn());
    expect(hover.hoveredObject).toBeNull();
  });

  it('disable하면 리스너를 떼고 색을 복원한다', () => {
    const { mesh, viewer, move, updateCallbacks } = makeEnv();
    const hover = new HoverHighlight();
    hover.enable(viewer);
    const original = mesh.material.emissive.getHex();
    move(50, 50);
    hover.disable();
    expect(mesh.material.emissive.getHex()).toBe(original);
    expect(updateCallbacks.length).toBe(0);
    move(50, 50);
    expect(hover.hoveredObject).toBeNull();
  });

  describe('throttleMs', () => {
    let now = 0;
    beforeEach(() => {
      now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => vi.restoreAllMocks());

    it('간격 안의 pointermove는 건너뛰고, 지나면 다시 처리한다', () => {
      const { mesh, viewer, move } = makeEnv();
      const hover = new HoverHighlight({ throttleMs: 50 });
      hover.enable(viewer);

      move(50, 50); // 처리됨
      expect(hover.hoveredObject).toBe(mesh);

      now += 10;
      move(2, 2); // 50ms 안 -> 무시, 여전히 강조 상태
      expect(hover.hoveredObject).toBe(mesh);

      now += 60;
      move(2, 2); // 간격 지남 -> 처리
      expect(hover.hoveredObject).toBeNull();
    });

    it('기본값(0)은 제한하지 않는다 (기존 동작 유지)', () => {
      const { mesh, viewer, move } = makeEnv();
      const hover = new HoverHighlight();
      hover.enable(viewer);
      move(50, 50);
      move(2, 2);
      expect(hover.hoveredObject).toBeNull();
      move(50, 50);
      expect(hover.hoveredObject).toBe(mesh);
    });
  });
});
