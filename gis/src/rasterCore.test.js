import { describe, expect, it } from 'vitest';
import { fromLonLat } from '../../viewer/src/kit/crsList.js';
import { cornersAreBlack, fitSize, isColorImage, outputSize, parseWorldFile, reprojectRgba, stretchToRgba, worldFileBbox, worldFileExtensions } from './rasterCore.js';

describe('월드파일', () => {
  it('확장자 후보 (이미지 종류마다)', () => {
    expect(worldFileExtensions('a.PNG')).toEqual(['pgw', 'pngw', 'wld']);
    expect(worldFileExtensions('a.jpg')).toEqual(['jgw', 'jpgw', 'wld']);
    expect(worldFileExtensions('a.tif')).toEqual(['tfw', 'tifw', 'wld']);
    expect(worldFileExtensions('a.xyz')).toEqual(['wld']);
  });

  it('6줄을 읽는다 (줄 바꿈 CRLF·빈 줄 허용)', () => {
    expect(parseWorldFile('0.5\r\n0\r\n0\r\n-0.5\r\n200000.25\r\n600000.75\r\n')).toEqual({ A: 0.5, D: 0, B: 0, E: -0.5, C: 200000.25, F: 600000.75 });
  });

  it('숫자 6줄이 아니거나 화소 크기가 0이면 오류', () => {
    expect(() => parseWorldFile('1\n2\n3')).toThrow(/6줄/);
    expect(() => parseWorldFile('a\n0\n0\n-1\n0\n0')).toThrow(/6줄/);
    expect(() => parseWorldFile('0\n0\n0\n-1\n0\n0')).toThrow(/0입니다/);
  });

  it('bbox: 왼쪽 위 화소 중심에서 반 화소 바깥이 가장자리', () => {
    const w = parseWorldFile('10\n0\n0\n-10\n1005\n2995');
    expect(worldFileBbox(w, 4, 3)).toEqual([1000, 2970, 1040, 3000]);
  });

  it('회전된 월드파일은 거절', () => {
    expect(() => worldFileBbox({ A: 1, D: 0.2, B: 0, E: -1, C: 0, F: 0 }, 10, 10)).toThrow(/회전/);
  });
});

describe('outputSize / fitSize', () => {
  it('긴 쪽이 maxDim, 위도에 따라 가로를 줄여 비율을 맞춘다', () => {
    const { outW, outH } = outputSize([127, 37, 128, 38], 1000);
    expect(outH).toBe(1000);
    expect(outW).toBeGreaterThan(780);
    expect(outW).toBeLessThan(810); // cos(37.5°) ≈ 0.793
  });
  it('fitSize 는 커지지 않는다', () => {
    expect(fitSize(8000, 4000, 4000)).toEqual({ width: 4000, height: 2000 });
    expect(fitSize(100, 50, 4000)).toEqual({ width: 100, height: 50 });
  });
});

describe('reprojectRgba', () => {
  /** 한 칸 색이 다른 2x2: (0,0)빨강 (1,0)초록 (0,1)파랑 (1,1)흰색 */
  const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);

  it('경위도 격자 원본은 그대로 옮겨진다 (항등 변환)', () => {
    const out = reprojectRgba({ rgba, width: 2, height: 2, bbox: [10, 20, 12, 22], toSource: (lon, lat) => [lon, lat], extent: [10, 20, 12, 22], outW: 2, outH: 2 });
    expect([...out]).toEqual([...rgba]);
  });

  it('원본 밖은 투명', () => {
    const out = reprojectRgba({ rgba, width: 2, height: 2, bbox: [10, 20, 12, 22], toSource: (lon, lat) => [lon, lat], extent: [9, 19, 13, 23], outW: 4, outH: 4 });
    expect(out[3]).toBe(0); // 왼쪽 위 모서리는 원본 밖
    const center = (1 * 4 + 1) * 4;
    expect(out[center + 3]).toBe(255); // (10~11, 21~22) 칸 = 원본 왼쪽 위
    expect([...out.slice(center, center + 3)]).toEqual([255, 0, 0]);
  });

  it('투영 좌표 원본: 5186 격자를 경위도로 다시 그리면 같은 지점의 색이 온다', () => {
    // 5186 에서 (200000, 600000) 이 중심인 100m x 100m, 화소 50m 의 2x2
    const bbox = [199950, 599950, 200050, 600050];
    const out = reprojectRgba({
      rgba,
      width: 2,
      height: 2,
      bbox,
      toSource: (lon, lat) => {
        const p = fromLonLat('EPSG:5186', lon, lat);
        return [p.x, p.y];
      },
      extent: [126.9995, 37.9995, 127.0005, 38.0005],
      outW: 2,
      outH: 2,
    });
    // 왼쪽 위 출력 화소 = 원본 왼쪽 위(빨강), 오른쪽 아래 = 흰색
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...out.slice(12, 16)]).toEqual([255, 255, 255, 255]);
  });

  it('검은색 투명 옵션', () => {
    const black = Uint8ClampedArray.from([0, 0, 0, 255, 9, 9, 9, 255]);
    const a = reprojectRgba({ rgba: black, width: 2, height: 1, bbox: [0, 0, 2, 1], toSource: (x, y) => [x, y], extent: [0, 0, 2, 1], outW: 2, outH: 1 });
    expect(a[3]).toBe(255);
    const b = reprojectRgba({ rgba: black, width: 2, height: 1, bbox: [0, 0, 2, 1], toSource: (x, y) => [x, y], extent: [0, 0, 2, 1], outW: 2, outH: 1, transparentBlack: true });
    expect(b[3]).toBe(0);
    expect(b[7]).toBe(255);
  });

  it('변환이 실패하는 지점은 투명으로 두고 멈추지 않는다', () => {
    const out = reprojectRgba({ rgba, width: 2, height: 2, bbox: [0, 0, 2, 2], toSource: () => { throw new Error('범위 밖'); }, extent: [0, 0, 2, 2], outW: 2, outH: 2 });
    expect([...out].every((v) => v === 0)).toBe(true);
  });
});

describe('cornersAreBlack', () => {
  it('네 모서리가 모두 검으면 true', () => {
    const px = (v) => [v, v, v, 255];
    const mk = (corners) => Uint8ClampedArray.from([...px(corners[0]), ...px(5), ...px(corners[1]), ...px(5), ...px(5), ...px(5), ...px(corners[2]), ...px(5), ...px(corners[3])]);
    expect(cornersAreBlack(mk([0, 0, 0, 0]), 3, 3)).toBe(true);
    expect(cornersAreBlack(mk([0, 0, 0, 9]), 3, 3)).toBe(false);
  });
});

describe('reprojectRgba: 격자 보간이 화소별 정확한 계산과 거의 같다', () => {
  it('5186 -> 경위도, 64x64 출력에서 간격 8 과 1(정확)의 차이가 작다', () => {
    const W = 40;
    const H = 40;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) rgba.set([c * 6, r * 6, ((c + r) * 3) % 256, 255], (r * W + c) * 4);
    const bbox = [199000, 599000, 201000, 601000];
    const toSource = (lon, lat) => {
      const p = fromLonLat('EPSG:5186', lon, lat);
      return [p.x, p.y];
    };
    const extent = [126.98, 37.98, 127.02, 38.02];
    const exact = reprojectRgba({ rgba, width: W, height: H, bbox, toSource, extent, outW: 64, outH: 64, gridStep: 1 });
    const fast = reprojectRgba({ rgba, width: W, height: H, bbox, toSource, extent, outW: 64, outH: 64, gridStep: 8 });
    let differ = 0;
    for (let i = 0; i < exact.length; i += 4) if (exact[i + 3] !== fast[i + 3] || Math.abs(exact[i] - fast[i]) > 12 || Math.abs(exact[i + 1] - fast[i + 1]) > 12) differ++;
    expect(differ / (64 * 64)).toBeLessThan(0.03);
  });

  it('큰 출력(4096x4096)도 몇 초 안에 끝난다 (화소마다 좌표 변환하면 수 분)', () => {
    const rgba = new Uint8ClampedArray(64 * 64 * 4).fill(200);
    const bbox = [100000, 500000, 300000, 700000];
    const t0 = Date.now();
    const out = reprojectRgba({
      rgba,
      width: 64,
      height: 64,
      bbox,
      toSource: (lon, lat) => {
        const p = fromLonLat('EPSG:5186', lon, lat);
        return [p.x, p.y];
      },
      extent: [125, 36, 129, 40],
      outW: 4096,
      outH: 4096,
    });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(out.length).toBe(4096 * 4096 * 4);
  });
});

describe('isColorImage (사진인가, 지형 값 격자인가)', () => {
  it.each([
    [{ bands: 3, bits: 8 }, true],
    [{ bands: 4, bits: 8 }, true],
    [{ bands: 3, bits: 16 }, true], // 16비트 정사영상·위성 영상
    [{ bands: 4, bits: 16, format: 1 }, true],
    [{ bands: 1, bits: 8, format: 1 }, true], // 흑백 사진, 색표 이미지
    [{ bands: 1, bits: 16, format: 2 }, false], // Int16 지형(SRTM 등)
    [{ bands: 1, bits: 32, format: 3 }, false], // 실수 지형
    [{ bands: 1, bits: 16, format: 1 }, false],
    [{ bands: 3, bits: 32, format: 3 }, false], // 실수 3밴드는 지형 값 묶음일 수 있다
  ])('%j -> %s', (o, expected) => {
    expect(isColorImage(o)).toBe(expected);
  });
});

describe('stretchToRgba (16비트 밝기 늘리기)', () => {
  const planes = (n, fn) => [0, 1, 2].map((b) => Float64Array.from({ length: n }, (_, i) => fn(i, b)));

  it('값이 일부 구간에 몰려 있어도 0~255 로 늘린다 (최소 쪽이 어둡고 최대 쪽이 밝다)', () => {
    const p = planes(1000, (i) => 1000 + i * 3); // 1000..3997
    const { rgba, min, max } = stretchToRgba(p);
    expect(min).toBeGreaterThanOrEqual(1000);
    expect(max).toBeLessThanOrEqual(3997);
    expect(rgba[0]).toBe(0); // 가장 작은 값
    expect(rgba[(999 * 4)]).toBe(255); // 가장 큰 값
    expect(rgba[(500 * 4)]).toBeGreaterThan(100);
    expect(rgba[(500 * 4)]).toBeLessThan(160);
    expect(rgba[3]).toBe(255);
  });

  it('모든 밴드가 0(또는 nodata·NaN)인 화소는 투명', () => {
    const p = planes(10, (i) => (i < 3 ? 0 : 100 + i));
    p[0][3] = Number.NaN;
    const { rgba, valid } = stretchToRgba(p);
    expect([0, 1, 2].map((i) => rgba[i * 4 + 3])).toEqual([0, 0, 0]);
    expect(rgba[3 * 4 + 3]).toBe(255); // 한 밴드가 NaN 이어도 다른 밴드에 값이 있으면 유효
    expect(valid).toBe(7);
    const withNodata = stretchToRgba(planes(10, (i) => (i < 2 ? -9999 : 100 + i)), { nodata: -9999 });
    expect(withNodata.rgba[3]).toBe(0);
    expect(withNodata.rgba[2 * 4 + 3]).toBe(255);
  });

  it('상하위 2% 극단값은 잘라내 한두 개 이상치가 전체를 어둡게 만들지 않는다', () => {
    const p = planes(1000, (i) => 1000 + i);
    for (const b of p) b[0] = 60000; // 밝은 이상치
    const { max } = stretchToRgba(p);
    expect(max).toBeLessThan(2000);
  });

  it('값이 모두 같으면(범위 0) 오류 없이 처리하고, 값이 하나도 없으면 전부 투명', () => {
    expect(stretchToRgba(planes(4, () => 500)).rgba[3]).toBe(255);
    const none = stretchToRgba(planes(4, () => 0));
    expect(none.valid).toBe(0);
    expect([...none.rgba].every((v) => v === 0)).toBe(true);
  });

  it('색 균형: 세 밴드를 함께 늘려서 한 밴드가 더 크면 그 색이 더 진하게 남는다', () => {
    const p = [Float64Array.of(1000, 4000), Float64Array.of(1000, 2000), Float64Array.of(1000, 1000)];
    const { rgba } = stretchToRgba(p, { low: 0, high: 1 });
    expect(rgba[4]).toBeGreaterThan(rgba[5]); // 두 번째 화소: R > G
    expect(rgba[5]).toBeGreaterThan(rgba[6]); // G > B
  });
});
