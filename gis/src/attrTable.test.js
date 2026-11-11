import { describe, expect, it } from 'vitest';
import { buildTable, columnStats, columnWidths, displayValue, geometryBounds, parseCondition, queryRows, sortRows, tableToTsv, visualLength } from './attrTable.js';

const feat = (properties, geometry = { type: 'Point', coordinates: [127, 37.5] }) => ({ type: 'Feature', properties, geometry });
const sample = {
  type: 'FeatureCollection',
  features: [
    feat({ 이름: '가', 값: 10, 분류: 'A' }),
    feat({ 이름: '나', 값: 2, 분류: 'B', 메모: '첫째' }),
    feat({ 이름: '다', 값: 33, 분류: 'A' }, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }),
    feat({ 이름: '라', 값: null, 분류: 'B' }, null),
    feat(null, { type: 'LineString', coordinates: [[0, 0], [2, 2]] }),
  ],
};

describe('buildTable', () => {
  const t = buildTable(sample);

  it('번호·도형 열 다음에 속성 열이 처음 나온 순서로 모인다 (일부 피처에만 있는 열도 포함)', () => {
    expect(t.size).toBe(5);
    expect(t.columns.map((c) => c.name)).toEqual(['번호', '도형', '이름', '값', '분류', '메모']);
    expect(t.columns.map((c) => c.kind)).toEqual(['index', 'geom', 'prop', 'prop', 'prop', 'prop']);
  });

  it('값을 글자로 바꾼다 (없음·빈 값은 빈 글자, 도형이 없으면 (없음))', () => {
    expect(t.text(0, 0)).toBe('1');
    expect(t.text(0, 1)).toBe('점');
    expect(t.text(2, 1)).toBe('면');
    expect(t.text(3, 1)).toBe('(없음)');
    expect(t.text(1, 5)).toBe('첫째');
    expect(t.text(0, 5)).toBe('');
    expect(t.text(3, 3)).toBe('');
    expect(t.text(4, 2)).toBe(''); // properties 가 null
    expect(displayValue({ a: 1 })).toBe('{"a":1}');
  });

  it('열이 너무 많으면 잘라서 알린다', () => {
    const wide = { features: [feat(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`c${i}`, i])))] };
    const r = buildTable(wide, { maxColumns: 5 });
    expect(r.truncated).toBe(true);
    expect(r.columns).toHaveLength(7);
  });

  it('피처가 없어도 만들어진다', () => {
    expect(buildTable({ features: [] }).size).toBe(0);
    expect(buildTable(null).size).toBe(0);
  });
});

describe('parseCondition', () => {
  it('열을 골랐을 때만 숫자 조건, 아니면 글자 검색', () => {
    expect(parseCondition('', true)).toEqual({ kind: 'none' });
    expect(parseCondition('>=10', true)).toEqual({ kind: 'number', op: '>=', value: 10 });
    expect(parseCondition(' < -2.5 ', true)).toEqual({ kind: 'number', op: '<', value: -2.5 });
    expect(parseCondition('>10', false)).toEqual({ kind: 'text', needle: '>10' });
    expect(parseCondition('서울', true)).toEqual({ kind: 'text', needle: '서울' });
  });
});

describe('queryRows', () => {
  const t = buildTable(sample);
  const col = (name) => t.columns.findIndex((c) => c.name === name);

  it('검색이 없으면 모든 행', () => {
    expect(queryRows(t).rows).toEqual([0, 1, 2, 3, 4]);
  });

  it('모든 열에서 글자 포함 검색 (대소문자 무시, 도형 종류도 대상)', () => {
    expect(queryRows(t, { search: 'a' }).rows).toEqual([0, 2]);
    expect(queryRows(t, { search: '첫째' }).rows).toEqual([1]);
    expect(queryRows(t, { search: '면' }).rows).toEqual([2]);
  });

  it('열을 고르면 그 열에서만 찾고, 숫자 조건도 쓸 수 있다', () => {
    expect(queryRows(t, { search: 'B', column: col('분류') }).rows).toEqual([1, 3]);
    expect(queryRows(t, { search: '>5', column: col('값') }).rows).toEqual([0, 2]);
    expect(queryRows(t, { search: '<=10', column: col('값') }).rows).toEqual([0, 1]);
    expect(queryRows(t, { search: '=2', column: col('값') }).rows).toEqual([1]);
    expect(queryRows(t, { search: '!=2', column: col('값') }).rows).toEqual([0, 2]); // 빈 값은 숫자가 아니라 제외
  });

  it('검색 뒤 정렬: 숫자 열은 숫자 크기대로, 빈 값은 방향과 관계없이 맨 아래', () => {
    expect(queryRows(t, { sortCol: col('값'), sortDir: 1 }).rows).toEqual([1, 0, 2, 3, 4]);
    expect(queryRows(t, { sortCol: col('값'), sortDir: -1 }).rows).toEqual([2, 0, 1, 3, 4]);
    expect(queryRows(t, { search: 'A', column: col('분류'), sortCol: col('값'), sortDir: -1 }).rows).toEqual([2, 0]);
  });
});

describe('sortRows', () => {
  it('글자 열은 한글 순서, 같으면 원래 순서를 지킨다', () => {
    const t = buildTable({ features: ['다', '가', '나', '가'].map((v) => feat({ v })) });
    expect(sortRows(t, [0, 1, 2, 3], 2, 1)).toEqual([1, 3, 2, 0]);
    expect(sortRows(t, [0, 1, 2, 3], 2, -1)).toEqual([0, 2, 1, 3]);
  });

  it('숫자처럼 생긴 글자도 숫자로, 글자가 섞이면 글자로 (자연 순서)', () => {
    const nums = buildTable({ features: ['10', '9', '100'].map((v) => feat({ v })) });
    expect(sortRows(nums, [0, 1, 2], 2)).toEqual([1, 0, 2]);
    const mixed = buildTable({ features: ['a10', 'a9', 'a100'].map((v) => feat({ v })) });
    expect(sortRows(mixed, [0, 1, 2], 2)).toEqual([1, 0, 2]);
  });
});

describe('columnStats', () => {
  const t = buildTable(sample);
  const all = [0, 1, 2, 3, 4];
  const col = (name) => t.columns.findIndex((c) => c.name === name);

  it('숫자 열: 개수·빈 값·서로 다른 값·최소·최대·평균', () => {
    const s = columnStats(t, all, col('값'));
    expect(s).toMatchObject({ count: 3, empty: 2, distinct: 3 });
    expect(s.numeric).toEqual({ min: 2, max: 33, mean: 15 });
  });

  it('글자 열: 숫자 요약 없이 많은 값 순서', () => {
    const s = columnStats(t, all, col('분류'));
    expect(s.numeric).toBeNull();
    expect(s.top[0][1]).toBe(2);
    expect(s.top.map(([v]) => v).sort()).toEqual(['A', 'B']);
  });

  it('검색으로 걸러진 행만 센다', () => {
    expect(columnStats(t, [1], col('값')).numeric.max).toBe(2);
  });

  it('서로 다른 값이 상한을 넘으면 표시를 단다', () => {
    const big = buildTable({ features: Array.from({ length: 10 }, (_, i) => feat({ v: `x${i}` })) });
    const rows = Array.from({ length: 10 }, (_, i) => i);
    expect(columnStats(big, rows, 2, { distinctCap: 4 })).toMatchObject({ distinct: 4, distinctCapped: true });
  });
});

describe('geometryBounds', () => {
  it('점·선·면·혼합의 경위도 범위, 좌표가 없으면 null', () => {
    expect(geometryBounds({ type: 'Point', coordinates: [127, 37] })).toEqual([127, 37, 127, 37]);
    expect(geometryBounds({ type: 'LineString', coordinates: [[1, 5], [3, 2]] })).toEqual([1, 2, 3, 5]);
    expect(geometryBounds({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] })).toEqual([0, 0, 6, 6]);
    expect(geometryBounds({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 1] }, { type: 'Point', coordinates: [2, 3] }] })).toEqual([1, 1, 2, 3]);
    expect(geometryBounds(null)).toBeNull();
    expect(geometryBounds({ type: 'Point', coordinates: [NaN, 1] })).toBeNull();
  });
});

describe('columnWidths / tableToTsv', () => {
  const t = buildTable(sample);
  it('열 폭은 최소·최대 안에서 글자 수에 맞춘다', () => {
    const w = columnWidths(t);
    expect(w).toHaveLength(t.columns.length);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(56);
    expect(Math.max(...w)).toBeLessThanOrEqual(280);
  });

  it('한글은 영문의 두 배 폭으로 어림한다', () => {
    expect(visualLength('abc')).toBe(3);
    expect(visualLength('구역 나')).toBe(7);
    const ko = buildTable({ features: [feat({ n: '가나다라마바사아' })] });
    const en = buildTable({ features: [feat({ n: 'abcdefgh' })] });
    expect(columnWidths(ko)[2]).toBeGreaterThan(columnWidths(en)[2]);
  });

  it('보이는 행만 탭으로 나눈 글자로 만든다 (탭·줄바꿈은 공백으로)', () => {
    const t2 = buildTable({ features: [feat({ a: '줄\n바꿈\t탭' }), feat({ a: 'x' })] });
    const tsv = tableToTsv(t2, [1, 0]);
    expect(tsv.split('\n')).toEqual(['번호\t도형\ta', '2\t점\tx', '1\t점\t줄 바꿈 탭']);
  });
});
