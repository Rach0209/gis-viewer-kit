import { describe, it, expect } from 'vitest';
import { createLocalStorageAdapter, resolvePersistence } from './persistence.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

describe('createLocalStorageAdapter', () => {
  it('scope별로 저장하고 불러온다', () => {
    const storage = fakeStorage();
    const a = createLocalStorageAdapter('p:', storage);
    a.save('site-a|geo', [{ position: { x: 1, y: 2, z: 3 }, text: '출입구' }]);
    a.save('site-b|model', [{ position: { x: 0, y: 0, z: 0 }, text: 'B' }]);
    expect(a.load('site-a|geo')).toEqual([{ position: { x: 1, y: 2, z: 3 }, text: '출입구' }]);
    expect(a.load('site-b|model')[0].text).toBe('B');
    expect(a.load('없는-scope')).toEqual([]);
  });

  it('손상된 JSON이나 배열이 아닌 값은 빈 목록으로 취급한다', () => {
    const storage = fakeStorage({ 'p:x': '{broken', 'p:y': '{"a":1}' });
    const a = createLocalStorageAdapter('p:', storage);
    expect(a.load('x')).toEqual([]);
    expect(a.load('y')).toEqual([]);
  });

  it('저장소 접근이 예외를 던져도 앱이 죽지 않는다', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const a = createLocalStorageAdapter('p:', broken);
    expect(a.load('s')).toEqual([]);
    expect(() => a.save('s', [1])).not.toThrow();
  });
});

describe('resolvePersistence', () => {
  it("'none'/undefined는 null", () => {
    expect(resolvePersistence('none')).toBeNull();
    expect(resolvePersistence(undefined)).toBeNull();
  });

  it('사용자 정의 어댑터를 그대로 쓴다', () => {
    const custom = { load: () => [], save: () => {} };
    expect(resolvePersistence(custom)).toBe(custom);
  });

  it('잘못된 값은 이해하기 쉬운 오류', () => {
    expect(() => resolvePersistence({})).toThrow(/persistence/);
  });
});
