import { describe, expect, it } from 'vitest';
import { MEMO_MAX, createMemoStore, memoKey } from './memoStore.js';

const fakeStorage = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

describe('memoStore', () => {
  it('저장하고 다시 불러온다 (종류·이름별로 따로)', () => {
    const s = createMemoStore(fakeStorage());
    expect(s.load('vector', 'a.shp')).toBe('');
    expect(s.save('vector', 'a.shp', '용도지역 2024 자료')).toBe(true);
    expect(s.load('vector', 'a.shp')).toBe('용도지역 2024 자료');
    expect(s.load('model', 'a.shp')).toBe('');
    expect(s.load('vector', 'b.shp')).toBe('');
  });
  it('글자를 모두 지우면 저장소에서도 지운다', () => {
    const st = fakeStorage();
    const s = createMemoStore(st);
    s.save('tileset', 'x', 'hi');
    expect(st.m.has(memoKey('tileset', 'x'))).toBe(true);
    s.save('tileset', 'x', '');
    expect(st.m.has(memoKey('tileset', 'x'))).toBe(false);
    expect(s.load('tileset', 'x')).toBe('');
  });
  it(`${MEMO_MAX}자까지만 저장한다`, () => {
    const s = createMemoStore(fakeStorage());
    s.save('model', 'm', 'a'.repeat(MEMO_MAX + 50));
    expect(s.load('model', 'm')).toHaveLength(MEMO_MAX);
  });
  it('저장소가 없거나 오류를 내도 이 페이지 안에서는 동작한다', () => {
    const none = createMemoStore(null);
    expect(none.save('model', 'm', '메모')).toBe(false);
    expect(none.load('model', 'm')).toBe('메모');
    const broken = createMemoStore({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } });
    expect(broken.save('model', 'm', '메모')).toBe(false);
    expect(broken.load('model', 'm')).toBe('메모');
  });
});
