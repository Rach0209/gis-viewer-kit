import { describe, it, expect } from 'vitest';
import { LayerManager } from './LayerManager.js';

// LayerManager는 THREE.Scene이나 WebGL을 직접 다루지 않고, viewer.scene.add/remove와
// viewer.add/removeUpdateCallback만 호출한다. 그래서 진짜 Viewer/THREE 없이도
// 이 정도만 흉내 내는 가짜 객체로 충분히 테스트할 수 있다.
function createFakeViewer() {
  const sceneChildren = [];
  const updateCallbacks = [];
  return {
    scene: {
      add: (obj) => sceneChildren.push(obj),
      remove: (obj) => {
        const i = sceneChildren.indexOf(obj);
        if (i !== -1) sceneChildren.splice(i, 1);
      },
    },
    addUpdateCallback: (fn) => updateCallbacks.push(fn),
    removeUpdateCallback: (fn) => {
      const i = updateCallbacks.indexOf(fn);
      if (i !== -1) updateCallbacks.splice(i, 1);
    },
    _sceneChildren: sceneChildren,
    _updateCallbacks: updateCallbacks,
  };
}

/** @param {{throwOnAdd?: boolean}} [options] */
function createFakeLayer(id, { throwOnAdd = false } = {}) {
  const calls = { onAdd: 0, onRemove: 0, update: 0, dispose: 0 };
  return {
    id,
    object3d: { name: `layer:${id}` },
    onAdd() {
      calls.onAdd++;
      if (throwOnAdd) throw new Error(`onAdd failed for ${id}`);
    },
    onRemove() {
      calls.onRemove++;
    },
    update() {
      calls.update++;
    },
    dispose() {
      calls.dispose++;
    },
    calls,
  };
}

describe('LayerManager.add', () => {
  it('calls onAdd, registers the layer, and adds its object3d to the scene', () => {
    const viewer = createFakeViewer();
    const manager = new LayerManager(viewer);
    const layer = createFakeLayer('a');

    manager.add(layer);

    expect(layer.calls.onAdd).toBe(1);
    expect(manager.get('a')).toBe(layer);
    expect(viewer._sceneChildren).toContain(layer.object3d);
  });

  it('throws when adding a layer whose id is already registered', () => {
    const viewer = createFakeViewer();
    const manager = new LayerManager(viewer);
    manager.add(createFakeLayer('dup'));

    expect(() => manager.add(createFakeLayer('dup'))).toThrow(/already exists/);
  });

  it('does not register the layer or touch the scene if onAdd() throws', () => {
    // 코드 리뷰에서 나온 "좀비 레이어" 버그에 대한 회귀 테스트: onAdd가 실패하면
    // 절반만 추가된 상태로 남으면 안 된다.
    const viewer = createFakeViewer();
    const manager = new LayerManager(viewer);
    const layer = createFakeLayer('broken', { throwOnAdd: true });

    expect(() => manager.add(layer)).toThrow('onAdd failed for broken');
    expect(manager.get('broken')).toBeUndefined();
    expect(viewer._sceneChildren).not.toContain(layer.object3d);
    // 등록되지 않았으니 같은 id로 다시(정상적으로) 추가할 수 있어야 한다.
    const retried = createFakeLayer('broken');
    expect(() => manager.add(retried)).not.toThrow();
    expect(manager.get('broken')).toBe(retried);
  });
});

describe('LayerManager.remove', () => {
  it('calls onRemove and dispose, removes the object3d from the scene, and forgets the layer', () => {
    const viewer = createFakeViewer();
    const manager = new LayerManager(viewer);
    const layer = createFakeLayer('a');
    manager.add(layer);

    manager.remove('a');

    expect(layer.calls.onRemove).toBe(1);
    expect(layer.calls.dispose).toBe(1);
    expect(viewer._sceneChildren).not.toContain(layer.object3d);
    expect(manager.get('a')).toBeUndefined();
  });

  it('does nothing for an id that was never added', () => {
    const viewer = createFakeViewer();
    const manager = new LayerManager(viewer);
    expect(() => manager.remove('missing')).not.toThrow();
  });
});

describe('LayerManager.getAll / updateAll', () => {
  it('getAll returns every currently-registered layer', () => {
    const viewer = createFakeViewer();
    const manager = new LayerManager(viewer);
    const a = createFakeLayer('a');
    const b = createFakeLayer('b');
    manager.add(a);
    manager.add(b);

    expect(manager.getAll()).toEqual(expect.arrayContaining([a, b]));
    expect(manager.getAll()).toHaveLength(2);
  });

  it('updateAll calls update() on every layer', () => {
    const viewer = createFakeViewer();
    const manager = new LayerManager(viewer);
    const a = createFakeLayer('a');
    const b = createFakeLayer('b');
    manager.add(a);
    manager.add(b);

    manager.updateAll(/* camera */ {}, /* dt */ 0.16);

    expect(a.calls.update).toBe(1);
    expect(b.calls.update).toBe(1);
  });

  it('registers itself as a viewer update callback so updateAll runs every frame automatically', () => {
    const viewer = createFakeViewer();
    const manager = new LayerManager(viewer);
    const layer = createFakeLayer('a');
    manager.add(layer);

    expect(viewer._updateCallbacks).toHaveLength(1);
    viewer._updateCallbacks[0](/* camera */ {}, /* dt */ 0.16);
    expect(layer.calls.update).toBe(1);
  });
});

describe('LayerManager.disposeAll', () => {
  it('removes every layer and unregisters its own update callback', () => {
    const viewer = createFakeViewer();
    const manager = new LayerManager(viewer);
    const a = createFakeLayer('a');
    const b = createFakeLayer('b');
    manager.add(a);
    manager.add(b);

    manager.disposeAll();

    expect(a.calls.dispose).toBe(1);
    expect(b.calls.dispose).toBe(1);
    expect(manager.getAll()).toEqual([]);
    expect(viewer._updateCallbacks).toHaveLength(0);
  });
});
