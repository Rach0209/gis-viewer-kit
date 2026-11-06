import { describe, it, expect } from 'vitest';
import { PickableRegistry } from './PickableRegistry.js';

// three.js Object3D 인스턴스가 필요 없는 순수 로직이므로, 등록 키로는
// 아무 객체나(plain object) 써도 충분하다 -- Map 키는 참조 동일성만 본다.
function fakeObject(label) {
  return { label };
}

describe('PickableRegistry', () => {
  it('returns registered objects from getAll', () => {
    const registry = new PickableRegistry();
    const a = fakeObject('a');
    const b = fakeObject('b');
    registry.register(a, { id: 'a' }, 'layer-1');
    registry.register(b, { id: 'b' }, 'layer-1');

    expect(registry.getAll()).toEqual(expect.arrayContaining([a, b]));
    expect(registry.getAll()).toHaveLength(2);
  });

  it('removes only the specified object via unregister', () => {
    const registry = new PickableRegistry();
    const a = fakeObject('a');
    const b = fakeObject('b');
    registry.register(a, {}, 'layer-1');
    registry.register(b, {}, 'layer-1');

    registry.unregister(a);

    expect(registry.has(a)).toBe(false);
    expect(registry.has(b)).toBe(true);
  });

  it('removes every object belonging to a layer via unregisterByLayer, leaving other layers untouched', () => {
    const registry = new PickableRegistry();
    const a = fakeObject('a');
    const b = fakeObject('b');
    const c = fakeObject('c');
    registry.register(a, {}, 'layer-1');
    registry.register(b, {}, 'layer-1');
    registry.register(c, {}, 'layer-2');

    registry.unregisterByLayer('layer-1');

    expect(registry.getAll()).toEqual([c]);
  });

  it('returns the metadata passed at register time', () => {
    const registry = new PickableRegistry();
    const a = fakeObject('a');
    const metadata = { z: 15, x: 1, y: 2 };
    registry.register(a, metadata, 'layer-1');

    expect(registry.getMetadata(a)).toBe(metadata);
  });

  it('returns undefined metadata for an object that was never registered', () => {
    const registry = new PickableRegistry();
    expect(registry.getMetadata(fakeObject('never-registered'))).toBeUndefined();
  });

  it('clear() empties the registry', () => {
    const registry = new PickableRegistry();
    registry.register(fakeObject('a'), {}, 'layer-1');
    registry.clear();
    expect(registry.getAll()).toEqual([]);
  });
});
