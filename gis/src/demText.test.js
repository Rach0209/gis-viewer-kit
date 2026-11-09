import { describe, expect, it } from 'vitest';
import { createMosaicSampler, createSampler } from './demCore.js';
import { gridFromXyz, isAsciiGrid, parseAsciiGrid, parseDemTextFile, parseXyz, readDemText } from './demText.js';

const blob = (text, name = 'a.txt') => Object.assign(new Blob([text]), { name });

describe('parseXyz', () => {
  it('공백·쉼표·탭 구분, 머리글·빈 줄은 건너뜀', () => {
    const r = parseXyz('X Y Z\n200000.5 549910.25 16.78\n\n200000.5,549820.25,9.62\r\n200090.5\t550000.25\t19.62\n');
    expect(Array.from(r.x)).toEqual([200000.5, 200000.5, 200090.5]);
    expect(Array.from(r.z)).toEqual([16.78, 9.62, 19.62]);
    expect(r.skipped).toBe(1);
  });
});

describe('gridFromXyz', () => {
  // 사용자 파일과 같은 모양: x 고정, y 내림차순, 그다음 x 증가 (90 m 간격)
  const lines = [];
  const xs = [200000.5, 200090.5, 200180.5];
  const ys = [550000.25, 549910.25, 549820.25, 549730.25];
  for (const x of xs) for (const y of ys) lines.push(`${x} ${y} ${((x - 200000.5) / 90) * 100 + (550000.25 - y) / 90}`);
  const grid = gridFromXyz(parseXyz(lines.join('\n')));

  it('크기, 해상도, 경계(점은 칸 중심)', () => {
    expect([grid.width, grid.height]).toEqual([3, 4]);
    expect(grid.resolution[0]).toBeCloseTo(90, 6);
    expect(grid.resolution[1]).toBeCloseTo(90, 6);
    expect(grid.bbox[0]).toBeCloseTo(200000.5 - 45, 6);
    expect(grid.bbox[2]).toBeCloseTo(200180.5 + 45, 6);
    expect(grid.bbox[1]).toBeCloseTo(549730.25 - 45, 6);
    expect(grid.bbox[3]).toBeCloseTo(550000.25 + 45, 6);
  });
  it('값이 제자리에 들어간다 (행 0이 북쪽, 열 0이 서쪽)', () => {
    const s = createSampler({ ...grid, nodata: null }, (x, y) => [x, y]);
    expect(s.sampleXY(200000.5, 550000.25)).toBeCloseTo(0, 4); // 북서 점
    expect(s.sampleXY(200090.5, 550000.25)).toBeCloseTo(100, 4); // 한 칸 동쪽
    expect(s.sampleXY(200000.5, 549910.25)).toBeCloseTo(1, 4); // 한 칸 남쪽
    expect(s.sampleXY(200180.5, 549730.25)).toBeCloseTo(203, 4); // 남동 점
  });
  it('빠진 점은 값 없음(NaN)', () => {
    const pts = parseXyz('0 0 1\n10 0 2\n20 0 3\n0 10 4\n10 10 5');
    const g = gridFromXyz(pts); // (20,10) 점이 없다
    expect(g.width * g.height).toBe(6);
    expect(Array.from(g.data).filter(Number.isNaN)).toHaveLength(1);
  });
  it('경위도 격자(0.001도)도 읽는다', () => {
    const g = gridFromXyz(parseXyz('127.000 37.502 1\n127.001 37.502 2\n127.000 37.501 3\n127.001 37.501 4'));
    expect(g.resolution[0]).toBeCloseTo(0.001, 9);
    expect(g.bbox[0]).toBeCloseTo(126.9995, 7);
    expect(g.bbox[3]).toBeCloseTo(37.5025, 7);
  });
  it('격자가 아니면 안내하는 오류', () => {
    const random = Array.from({ length: 60 }, (_, i) => `${i * 7.31 + (i % 3) * 0.37} ${i * 5.13 + (i % 5) * 0.41} ${i}`).join('\n');
    expect(() => gridFromXyz(parseXyz(random))).toThrow(/격자/);
    expect(() => gridFromXyz(parseXyz('1 2 3'))).toThrow(/점이 너무 적/);
  });
});

describe('ASCII 격자', () => {
  const text = 'ncols 3\nnrows 2\nxllcorner 100\nyllcorner 200\ncellsize 10\nNODATA_value -9999\n1 2 3\n4 -9999 6\n';
  it('감지와 읽기', () => {
    expect(isAsciiGrid(text)).toBe(true);
    expect(isAsciiGrid('1 2 3\n')).toBe(false);
    const g = parseAsciiGrid(text);
    expect([g.width, g.height]).toEqual([3, 2]);
    expect(g.bbox).toEqual([100, 200, 130, 220]);
    expect(g.nodata).toBe(-9999);
    expect(Array.from(g.data)).toEqual([1, 2, 3, 4, -9999, 6]);
  });
  it('xllcenter 는 반 칸 안쪽', () => {
    const g = parseAsciiGrid('ncols 2\nnrows 1\nxllcenter 105\nyllcenter 205\ncellsize 10\n1 2');
    expect(g.bbox).toEqual([100, 200, 120, 210]);
  });
  it('값이 모자라면 오류', () => {
    expect(() => parseAsciiGrid('ncols 3\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 2 3')).toThrow(/모자랍니다/);
  });
});

describe('readDemText', () => {
  it('XYZ 여러 파일(도엽)은 도엽별로 따로 담는다 (전체 통계는 합산)', async () => {
    const a = blob('0 10 1\n10 10 2\n0 0 3\n10 0 4', '도엽1.txt');
    const b = blob('20 10 5\n30 10 6\n20 0 7\n30 0 8', '도엽2.txt');
    const dem = await readDemText([a, b]);
    expect(dem.tiles).toHaveLength(2);
    expect(dem.data).toBeNull();
    expect(dem.name).toBe('도엽1.txt 외 1개');
    expect(dem.crs).toBeNull();
    expect(dem.stats).toMatchObject({ min: 1, max: 8, valid: 8, invalid: 0 });
    expect(dem.stats.mean).toBeCloseTo(4.5, 6);
    expect(dem.bbox).toEqual([-5, -5, 35, 15]);
    expect(dem.source).toContain('도엽');
  });
  it('도엽마다 점 격자의 시작 위치·간격이 달라도 열린다 (한 격자로는 합칠 수 없는 경우)', async () => {
    const mk = (x0, y0, step, n) => {
      const lines = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) lines.push(`${(x0 + i * step).toFixed(2)} ${(y0 - j * step).toFixed(2)} ${x0 + i * step - 200000 + (y0 - j * step) - 547000}`); // 값이 작아야 Float32 정밀도로 비교할 수 있다
      return lines.join('\n');
    };
    const dem = await readDemText([blob(mk(200000.5, 550000.25, 90, 12), 'a.txt'), blob(mk(201100.75, 550000.25, 90, 12), 'b.txt')]);
    expect(dem.tiles).toHaveLength(2);
    const s = createMosaicSampler(dem.tiles, (x, y) => [x, y]);
    expect(s.sampleXY(200000.5 + 90 * 3, 550000.25 - 90 * 2)).toBeCloseTo(0.5 + 270 + 3000.25 - 180, 2); // 첫 도엽
    expect(s.sampleXY(201100.75 + 90 * 5, 550000.25 - 90 * 4)).toBeCloseTo(1100.75 + 450 + 3000.25 - 360, 2); // 둘째 도엽
  });
  it('도엽 하나가 격자가 아니면 그 파일 이름을 알려 준다', async () => {
    const good = blob('0 10 1\n10 10 2\n0 0 3\n10 0 4', 'ok.txt');
    const random = Array.from({ length: 60 }, (_, i) => `${i * 7.31 + (i % 3) * 0.37} ${i * 5.13 + (i % 5) * 0.41} ${i}`).join('\n');
    await expect(readDemText([good, blob(random, '불규칙.txt')])).rejects.toThrow(/불규칙\.txt/);
  });
  it('ASCII 격자 한 개', async () => {
    const dem = await readDemText([blob('ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 5\nNODATA_value -1\n1 2\n3 -1')]);
    expect(dem.nodata).toBe(-1);
    expect(dem.stats).toMatchObject({ valid: 3, invalid: 1 });
  });
  it('숫자 세 개 줄이 없으면 분명한 오류', async () => {
    await expect(readDemText([blob('hello world\nthis is not dem', 'readme.txt')])).rejects.toThrow(/readme\.txt/);
  });
  it('ASCII 격자를 여러 개 한꺼번에 주면 오류', async () => {
    const g = 'ncols 1\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 1\n5';
    await expect(readDemText([blob(g), blob(g)])).rejects.toThrow(/하나씩/);
  });
});

// ---------------------------------------------------------------- 읽기 규칙 고정 (줄 단위 분리 + Number와 같은 결과)
const referenceXyz = (text) => {
  const out = { x: [], y: [], z: [], skipped: 0 };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const p = line.split(/[\s,;]+/);
    const x = Number(p[0]);
    const y = Number(p[1]);
    const z = Number(p[2]);
    if (p.length >= 3 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      out.x.push(x);
      out.y.push(y);
      out.z.push(z);
    } else out.skipped++;
  }
  return out;
};

describe('parseXyz: 읽기 규칙', () => {
  const same = (text) => {
    const a = parseXyz(text);
    const b = referenceXyz(text);
    expect(Array.from(a.x)).toEqual(b.x);
    expect(Array.from(a.y)).toEqual(b.y);
    expect(Array.from(a.z)).toEqual(b.z);
    expect(a.skipped).toBe(b.skipped);
  };
  it('다양한 숫자 모양', () => {
    same('1 2 3\n-1.5 +2.25 -0\n.5 5. 007\n1e3 2E-2 -3.5e+1\n123456789012345 0.1 0.7\n1234567890123456789 12345678901.23456789 1\n');
  });
  it('머리글·모자란 줄·글자 섞인 줄·여분 열', () => {
    same('x y z\n1 2\n1 2 abc\nNaN 1 2\nInfinity 1 2\n1 2 3 4 5\n  \n\t\n1,2,3\n1;2;3\n 1 , 2 , 3 \n');
  });
  it('끝 줄 바꿈 없음, CRLF, 앞뒤 공백', () => {
    same('1 2 3\r\n4 5 6\r\n7 8 9');
    same('   1   2   3   \n\n\n  4 5 6');
  });
  it('실제 같은 좌표(소수 2자리)를 정확히 읽는다', () => {
    const lines = [];
    for (let i = 0; i < 500; i++) lines.push(`${(200305.31 + i * 90.01).toFixed(2)} ${(547459.91 - i * 90.01).toFixed(2)} ${(16.78 + i / 7).toFixed(2)}`);
    same(lines.join('\n'));
  });
});

describe('parseAsciiGrid: 큰 격자도 한 번 훑어 읽는다', () => {
  it('값 사이 구분(공백·줄 바꿈·CRLF)과 음수·소수', () => {
    const g = parseAsciiGrid('ncols 3\r\nnrows 2\r\nxllcorner 0\r\nyllcorner 0\r\ncellsize 10\r\nNODATA_value -9999\r\n1 2.5 -3\r\n  4   5\t6\r\n');
    expect(Array.from(g.data)).toEqual([1, 2.5, -3, 4, 5, 6]);
    expect(g.nodata).toBe(-9999);
  });
});

describe('격자 크기 상한 (저사양 모드에서 낮아진다)', () => {
  const pts = (w, h) => {
    const x = [], y = [], z = [];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { x.push(c * 10); y.push(r * 10); z.push(1); }
    return { x, y, z };
  };
  it('XYZ 격자가 상한을 넘으면 거절하고 안내 문장을 덧붙인다', () => {
    expect(() => gridFromXyz(pts(10, 10), { maxPixels: 50, hint: ' [안내]' })).toThrow(/격자가 너무 큽니다.*\[안내\]/);
    expect(gridFromXyz(pts(10, 10), { maxPixels: 100 }).width).toBe(10);
  });
  it('ASCII 격자도 상한을 지킨다', () => {
    const g = 'ncols 10\nnrows 10\nxllcorner 0\nyllcorner 0\ncellsize 1\n' + '1 '.repeat(100);
    expect(() => parseAsciiGrid(g, { maxPixels: 50, hint: ' [안내]' })).toThrow(/\[안내\]/);
    expect(parseAsciiGrid(g, { maxPixels: 100 }).data.length).toBe(100);
  });
  it('파일이 상한에 맞는 크기(상한 x 4바이트)를 넘으면 읽기 전에 거절한다', async () => {
    const big = Object.assign(new Blob(['1 2 3\n'.repeat(100)]), { name: 'big.txt' }); // 600바이트
    await expect(parseDemTextFile(big, { maxPixels: 100, hint: ' [안내]' })).rejects.toThrow(/big\.txt.*너무 큽니다.*\[안내\]/);
    const ok = await parseDemTextFile(Object.assign(new Blob(['0 0 1\n10 0 2\n0 10 3\n10 10 4\n']), { name: 'ok.txt' }), { maxPixels: 100 });
    expect(ok.grid.width).toBe(2);
  });
});
