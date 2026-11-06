import { describe, expect, it } from 'vitest';
import { pickBest, withinRadius } from './snap.js';

describe('withinRadius', () => {
  const xyz = [0, 0, 0, 10, 0, 0, 3, 4, 0, 0, 0, 5.1];
  it('반지름 안의 점 번호만 (경계 포함)', () => {
    expect(withinRadius(xyz, 0, 0, 0, 5)).toEqual([0, 2]); // (3,4,0)은 거리 5
    expect(withinRadius(xyz, 0, 0, 0, 5.1)).toEqual([0, 2, 3]);
    expect(withinRadius(xyz, 10, 0, 0, 1)).toEqual([1]);
    expect(withinRadius(xyz, 100, 100, 100, 5)).toEqual([]);
    expect(withinRadius([], 0, 0, 0, 5)).toEqual([]);
  });
});

describe('pickBest', () => {
  it('화면 거리가 가장 가까운 것', () => {
    expect(pickBest([{ px: 8, kind: 'vertex', id: 'a' }, { px: 3, kind: 'vertex', id: 'b' }]).id).toBe('b');
  });
  it('점(POI)은 조금 유리하다 (3px 이내 차이면 POI)', () => {
    expect(pickBest([{ px: 5, kind: 'vertex', id: 'v' }, { px: 7, kind: 'poi', id: 'p' }]).id).toBe('p');
    expect(pickBest([{ px: 2, kind: 'vertex', id: 'v' }, { px: 7, kind: 'poi', id: 'p' }]).id).toBe('v');
  });
  it('후보가 없으면 null', () => {
    expect(pickBest([])).toBeNull();
  });
});
