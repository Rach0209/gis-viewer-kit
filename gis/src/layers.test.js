import { describe, expect, it, vi } from 'vitest';
import { createLayerStore } from './layers.js';

/** Cesium 없이 시험하려는 가짜 뷰어: 데이터 소스 컬렉션만 흉내 낸다 */
function fakeViewer() {
  const removed = [];
  return {
    removed,
    dataSources: { remove: vi.fn((o, destroy) => removed.push([o, destroy])) },
    imageryLayers: { remove: vi.fn() },
    scene: { primitives: { remove: vi.fn() } },
  };
}
const ds = (name) => ({ name, show: true });

describe('replaceObject (벡터 레이어의 도형만 바꿔 끼우기)', () => {
  it('새 도형으로 바꾸고 옛 도형은 지우며, 이름·메모·원본 자료는 그대로다', () => {
    const viewer = fakeViewer();
    const store = createLayerStore(viewer);
    const data = { type: 'FeatureCollection', features: [] };
    const old = ds('a');
    const layer = store.add({ name: 'a', kind: 'vector', object: old, host: 'dataSources', meta: { useHeights: false }, data });
    store.setMemo(layer.id, '메모');
    const next = ds('a');
    const seen = [];
    store.onChange((l) => seen.push(l));

    expect(store.replaceObject(layer.id, next, { meta: { useHeights: true, heightOffset: 27 }, style: null })).toBe(true);

    const now = store.get(layer.id);
    expect(now.object).toBe(next);
    expect(now.data).toBe(data);
    expect(now.memo).toBe('메모');
    expect(now.meta).toEqual({ useHeights: true, heightOffset: 27 });
    expect(viewer.removed).toEqual([[old, true]]);
    expect(seen).toHaveLength(1); // 목록을 한 번 다시 그리게 알린다
  });

  it('꺼 둔 레이어는 새 도형도 꺼진 채로 둔다', () => {
    const store = createLayerStore(fakeViewer());
    const layer = store.add({ name: 'a', kind: 'vector', object: ds('a'), host: 'dataSources' });
    store.setVisible(layer.id, false);
    const next = ds('a');
    store.replaceObject(layer.id, next);
    expect(next.show).toBe(false);
  });

  it('style 을 넘기지 않으면 스타일은 그대로, null 을 넘기면 해제', () => {
    const store = createLayerStore(fakeViewer());
    const style = { counts: [1] };
    const layer = store.add({ name: 'a', kind: 'vector', object: ds('a'), host: 'dataSources', style });
    store.replaceObject(layer.id, ds('a'), { meta: {} });
    expect(store.get(layer.id).style).toBe(style);
    store.replaceObject(layer.id, ds('a'), { style: null });
    expect(store.get(layer.id).style).toBeNull();
  });

  it('없는 레이어나 데이터 소스가 아닌 레이어는 false', () => {
    const viewer = fakeViewer();
    const store = createLayerStore(viewer);
    expect(store.replaceObject('nope', ds('x'))).toBe(false);
    const layer = store.add({ name: 'm', kind: 'model', object: { show: true }, host: 'primitives' });
    expect(store.replaceObject(layer.id, ds('x'))).toBe(false);
    expect(viewer.removed).toEqual([]);
  });
});
