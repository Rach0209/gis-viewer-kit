import { describe, expect, it } from 'vitest';
import { csvToPoints, detectDelimiter, guessCoordColumnsByName, guessCoordColumnsByValues, hasHeaderRow, numericColumns, parseDelimited } from './csvParse.js';

describe('parseDelimited', () => {
  it('쉼표, 따옴표 안의 쉼표·줄 바꿈·"" 이스케이프, CRLF, 빈 줄', () => {
    const rows = parseDelimited('a,b,c\r\n1,"x, y",3\r\n\r\n"줄\n바꿈","큰""따옴표",z\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', '3'],
      ['줄\n바꿈', '큰"따옴표', 'z'],
    ]);
  });
  it('끝 줄 바꿈이 없어도 마지막 줄을 읽고, 빈 칸은 빈 글자', () => {
    expect(parseDelimited('a,b\n1,', ',')).toEqual([['a', 'b'], ['1', '']]);
  });
  it('탭·세미콜론', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('a;b\n1;2', ';')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('detectDelimiter', () => {
  it.each([
    ['a,b,c\n1,2,3', ','],
    ['a\tb\tc\n1\t2\t3', '\t'],
    ['a;b;c\n1;2;3', ';'],
    ['a|b\n1|2', '|'],
    ['하나', ','],
  ])('%j -> %j', (text, d) => {
    expect(detectDelimiter(text)).toBe(d);
  });
  it('따옴표 안의 쉼표는 세지 않는다 (탭 구분인데 값에 쉼표가 많은 경우)', () => {
    expect(detectDelimiter('이름\t설명\n가\t"a,b,c,d"\n나\t"e,f,g,h"')).toBe('\t');
  });
});

describe('hasHeaderRow', () => {
  it('글자가 있으면 머리글, 모두 숫자면 아님', () => {
    expect(hasHeaderRow([['lon', 'lat'], ['1', '2']])).toBe(true);
    expect(hasHeaderRow([['127.1', '37.5'], ['127.2', '37.6']])).toBe(false);
    expect(hasHeaderRow([])).toBe(false);
  });
});

describe('열 이름으로 좌표 열 찾기', () => {
  it.each([
    [['id', 'lon', 'lat'], 1, 2],
    [['name', 'Longitude', 'Latitude'], 1, 2],
    [['번호', '경도', '위도'], 1, 2],
    [['번호', '경도(WGS84)', '위도(WGS84)'], 1, 2],
    [['id', 'X', 'Y'], 1, 2],
    [['x좌표', 'y좌표'], 0, 1],
    [['lng', 'lat'], 0, 1],
    [['Lat', 'Lon'], 1, 0],
    [['id', 'name'], -1, -1],
  ])('%j -> x=%i y=%i', (header, x, y) => {
    expect(guessCoordColumnsByName(header)).toEqual({ xCol: x, yCol: y });
  });
  it('lon/lat 과 x/y 가 함께 있으면 lon/lat 을 쓴다', () => {
    expect(guessCoordColumnsByName(['x', 'y', 'lon', 'lat'])).toEqual({ xCol: 2, yCol: 3 });
  });
});

describe('값으로 좌표 열 추정', () => {
  const rows = (...r) => r.map((x) => x.map(String));
  it('경위도 범위의 숫자 열 쌍', () => {
    expect(guessCoordColumnsByValues(rows([1, 127.1, 37.5], [2, 127.2, 37.6]), 3)).toEqual({ xCol: 1, yCol: 2 });
  });
  it('위도, 경도 순서인 자료', () => {
    expect(guessCoordColumnsByValues(rows([37.5, 127.1], [37.6, 127.2]), 2)).toEqual({ xCol: 1, yCol: 0 });
  });
  it('투영 좌표(큰 숫자) 두 열', () => {
    expect(guessCoordColumnsByValues(rows([1, 953901, 1952032], [2, 953950, 1952100]), 3)).toEqual({ xCol: 1, yCol: 2 });
  });
  it('못 찾으면 -1', () => {
    expect(guessCoordColumnsByValues(rows(['a', 'b'], ['c', 'd']), 2)).toEqual({ xCol: -1, yCol: -1 });
  });
  it('numericColumns: 숫자만 든 열 (빈 칸은 무시)', () => {
    expect(numericColumns(rows(['a', 1, ''], ['b', 2, 3]), 3)).toEqual([1, 2]);
  });
});

describe('csvToPoints', () => {
  it('머리글 + 경위도: 점을 만들고 나머지 열은 속성(숫자 열은 숫자)', () => {
    const r = csvToPoints('이름,lon,lat,수량\n가,127.1,37.5,10\n나,127.2,37.6,20\n');
    expect(r).toMatchObject({ xCol: 1, yCol: 2, delimiter: ',', header: true, rows: 2, skipped: 0 });
    expect(r.features[0]).toEqual({ type: 'Feature', geometry: { type: 'Point', coordinates: [127.1, 37.5] }, properties: { 이름: '가', 수량: 10 } });
  });

  it('BOM, 탭 구분, 따옴표 속성', () => {
    const r = csvToPoints('﻿id\tx\ty\tmemo\n1\t1\t2\t"a\tb"\n');
    expect(r.delimiter).toBe('\t');
    expect(r.features[0].properties).toEqual({ id: 1, memo: 'a\tb' });
  });

  it('머리글이 없으면 값으로 좌표 열을 추정하고 열1, 열2… 이름을 붙인다', () => {
    const r = csvToPoints('1,127.1,37.5\n2,127.2,37.6');
    expect(r.header).toBe(false);
    expect(r.columns).toEqual(['열1', '열2', '열3']);
    expect(r.features.length).toBe(2);
    expect(r.features[1].geometry.coordinates).toEqual([127.2, 37.6]);
  });

  it('좌표가 비었거나 숫자가 아닌 줄은 건너뛰고 알려 준다', () => {
    const r = csvToPoints('lon,lat\n127,37\n,\nabc,37\n128,38\n');
    expect(r.features.length).toBe(2);
    expect(r.skipped).toBe(2);
    expect(r.warnings.join('')).toContain('2개는 건너뛰었습니다');
  });

  it('앞자리 0이 있는 코드는 글자로 둔다 (우편번호)', () => {
    const r = csvToPoints('zip,lon,lat\n01234,127,37\n05678,128,38');
    expect(r.features[0].properties.zip).toBe('01234');
  });

  it('열을 직접 지정할 수 있다 (x/y 순서가 이상한 자료)', () => {
    const r = csvToPoints('a,b,c\n1,200000,600000\n', { xCol: 1, yCol: 2 });
    expect(r.features[0].geometry.coordinates).toEqual([200000, 600000]);
    expect(r.features[0].properties).toEqual({ a: 1 });
  });

  it('좌표 열을 못 찾으면 빈 결과와 안내', () => {
    const r = csvToPoints('이름,주소\n가,서울\n나,부산');
    expect(r.features).toEqual([]);
    expect(r.warnings[0]).toContain('직접 고르세요');
    expect(r.columns).toEqual(['이름', '주소']);
  });

  it('빈 파일', () => {
    expect(csvToPoints('').warnings[0]).toContain('비어');
  });

  it('세미콜론 구분과 큰 따옴표 머리글', () => {
    const r = csvToPoints('"경도";"위도";"값"\n127,5;37,5;1\n');
    // 쉼표 소수점은 숫자로 읽을 수 없어 건너뛴다 (소수점은 점만 지원)
    expect(r.delimiter).toBe(';');
    expect(r.features.length).toBe(0);
    expect(r.skipped).toBe(1);
  });
});
