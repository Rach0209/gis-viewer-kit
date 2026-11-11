import { writeArrayBuffer } from 'geotiff';
import { afterEach, describe, expect, it } from 'vitest';
import { fromLonLat } from '../../../viewer/src/kit/crsList.js';
import { openRasterFile, probeTiff, resetPool } from './client.js';
import { heldRasters } from './rasterJobs.js';

afterEach(() => resetPool());

/** 시험용 색 GeoTIFF (RGB 8비트): 칸마다 색이 다른 w x h */
function makeRgbTiff({ width, height, x0, y0, resX, resY, epsg, pixels }) {
  const values = [];
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values.push(...pixels(c, r));
  const meta = {
    width,
    height,
    SamplesPerPixel: 3,
    BitsPerSample: [8, 8, 8],
    PhotometricInterpretation: 2,
    ModelPixelScale: [resX, resY, 0],
    ModelTiepoint: [0, 0, 0, x0, y0, 0],
    GTRasterTypeGeoKey: 1,
    GTModelTypeGeoKey: epsg === 4326 ? 2 : 1,
    ...(epsg === 4326 ? { GeographicTypeGeoKey: 4326 } : { ProjectedCSTypeGeoKey: epsg }),
  };
  return Object.assign(new Blob([writeArrayBuffer(Uint8Array.from(values), meta)]), { name: 'ortho.tif' });
}

describe('probeTiff', () => {
  it('RGB 8비트는 색 이미지, 한 밴드 실수는 아님', async () => {
    const rgb = makeRgbTiff({ width: 2, height: 2, x0: 127, y0: 38, resX: 0.001, resY: 0.001, epsg: 4326, pixels: () => [1, 2, 3] });
    expect(await probeTiff(rgb)).toMatchObject({ width: 2, height: 2, bands: 3, bits: 8, isImage: true });
    const dem = Object.assign(new Blob([writeArrayBuffer(Float32Array.from([1, 2, 3, 4]), { width: 2, height: 2, ModelPixelScale: [1, 1, 0], ModelTiepoint: [0, 0, 0, 0, 0, 0], GTRasterTypeGeoKey: 1, GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326 })]), { name: 'dem.tif' });
    expect((await probeTiff(dem)).isImage).toBe(false);
  });
});

describe('openRasterFile (GeoTIFF)', () => {
  const colors = { '0,0': [255, 0, 0], '1,0': [0, 255, 0], '0,1': [0, 0, 255], '1,1': [255, 255, 255] };
  const pixels = (c, r) => colors[`${c},${r}`];

  it('경위도 GeoTIFF: 좌표계를 읽고, 같은 위치에 색이 그대로 다시 그려진다', async () => {
    const f = makeRgbTiff({ width: 2, height: 2, x0: 127, y0: 38, resX: 0.5, resY: 0.5, epsg: 4326, pixels });
    const r = await openRasterFile(f);
    expect(r.info).toMatchObject({ name: 'ortho.tif', srcWidth: 2, srcHeight: 2, crs: 'EPSG:4326' });
    expect(r.info.bbox).toEqual([127, 37, 128, 38]);
    const out = await r.project({ crs: 'EPSG:4326', maxDim: 2 });
    expect(out.extent).toEqual([127, 37, 128, 38]);
    // 출력은 위도 방향 비율에 따라 2x2 근처, 첫 화소 = 빨강
    expect([...out.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    r.release();
  });

  it('투영 좌표 GeoTIFF(5186): 경위도 범위로 바뀌고 색이 맞는 위치에 온다', async () => {
    const f = makeRgbTiff({ width: 2, height: 2, x0: 199950, y0: 600050, resX: 50, resY: 50, epsg: 5186, pixels });
    const r = await openRasterFile(f);
    expect(r.info.crs).toBe('EPSG:5186');
    const out = await r.project({ crs: 'EPSG:5186', maxDim: 64 });
    const [w, s, e, n] = out.extent;
    expect((w + e) / 2).toBeCloseTo(127, 3);
    expect((s + n) / 2).toBeCloseTo(38, 3);
    // 왼쪽 위 사분면은 빨강 계열, 오른쪽 아래 사분면은 흰색 (가운데 근처에서 확인)
    const at = (i, j) => [...out.rgba.slice((j * out.outW + i) * 4, (j * out.outW + i) * 4 + 4)];
    expect(at(Math.floor(out.outW * 0.25), Math.floor(out.outH * 0.25))).toEqual([255, 0, 0, 255]);
    expect(at(Math.floor(out.outW * 0.75), Math.floor(out.outH * 0.75))).toEqual([255, 255, 255, 255]);
    r.release();
  });

  it('좌표계를 직접 다시 골라도(다른 값) 원본은 다시 읽지 않는다', async () => {
    const f = makeRgbTiff({ width: 2, height: 2, x0: 199950, y0: 600050, resX: 50, resY: 50, epsg: 5186, pixels });
    const before = heldRasters();
    const r = await openRasterFile(f);
    expect(heldRasters()).toBe(before + 1);
    const a = await r.project({ crs: 'EPSG:5186', maxDim: 16 });
    const b = await r.project({ crs: 'EPSG:5181', maxDim: 16 }); // 같은 숫자라도 위치(위도)가 다르다
    expect(a.extent[1]).not.toBeCloseTo(b.extent[1], 2);
    expect(heldRasters()).toBe(before + 1);
    r.release();
    await new Promise((res) => setTimeout(res, 0));
    expect(heldRasters()).toBe(before);
  });

  it('월드파일(.tfw)을 같이 고르면 TIFF 안의 위치보다 그것을 쓴다', async () => {
    const values = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
    const blob = Object.assign(new Blob([writeArrayBuffer(values, { width: 2, height: 2, SamplesPerPixel: 3, BitsPerSample: [8, 8, 8], PhotometricInterpretation: 2 })]), { name: 'plain.tif' });
    const world = { arrayBuffer: async () => new TextEncoder().encode('10\n0\n0\n-10\n205\n595\n').buffer };
    const r = await openRasterFile(blob, { worldFile: world });
    expect(r.info.bbox).toEqual([200, 580, 220, 600]);
    expect(r.info.guessedCrs).toBeTruthy(); // 한국 안에 놓이는 좌표계 추정
    r.release();
  });

  it('PNG/JPG 는 월드파일 없이는 안 되고, 브라우저 밖(시험)에서는 읽을 수 없다고 알려 준다', async () => {
    const png = Object.assign(new Blob([Uint8Array.from([137, 80, 78, 71])]), { name: 'a.png' });
    await expect(openRasterFile(png)).rejects.toThrow(/월드파일/);
    const world = { arrayBuffer: async () => new TextEncoder().encode('1\n0\n0\n-1\n0\n0\n').buffer };
    await expect(openRasterFile(png, { worldFile: world })).rejects.toThrow(/PNG\/JPG 이미지를 읽을 수 없습니다/);
  });

  it('너무 큰 이미지는 거절하고 안내 문장을 덧붙인다', async () => {
    const f = makeRgbTiff({ width: 4, height: 4, x0: 127, y0: 38, resX: 0.1, resY: 0.1, epsg: 4326, pixels: () => [1, 2, 3] });
    await expect(openRasterFile(f, { limits: { maxPixels: 10, hint: ' [안내]' } })).rejects.toThrow(/너무 큽니다.*\[안내\]/);
  });

  it('닫은 뒤 다시 그리면 알아듣기 쉬운 오류', async () => {
    const f = makeRgbTiff({ width: 2, height: 2, x0: 127, y0: 38, resX: 0.5, resY: 0.5, epsg: 4326, pixels });
    const r = await openRasterFile(f);
    r.release();
    await new Promise((res) => setTimeout(res, 0));
    await expect(r.project({ crs: 'EPSG:4326' })).rejects.toThrow(/이미 닫힌/);
  });
});

describe('16비트·다밴드·흑백 영상', () => {
  /** n밴드 영상(칸마다 값이 fn(c, r, band)): 값 배열은 화소별로 밴드가 이어지는 방식 */
  function makeTiff({ width, height, bands, bits, fn, array, extra = {} }) {
    const values = [];
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) for (let b = 0; b < bands; b++) values.push(fn(c, r, b));
    const meta = {
      width,
      height,
      SamplesPerPixel: bands,
      BitsPerSample: Array(bands).fill(bits),
      PhotometricInterpretation: bands >= 3 ? 2 : 1,
      ModelPixelScale: [0.001, 0.001, 0],
      ModelTiepoint: [0, 0, 0, 127, 38, 0],
      GTRasterTypeGeoKey: 1,
      GTModelTypeGeoKey: 2,
      GeographicTypeGeoKey: 4326,
      ...extra,
    };
    return Object.assign(new Blob([writeArrayBuffer(array.from(values), meta)]), { name: 'scene.tif' });
  }

  it('16비트 3밴드는 지형이 아니라 이미지로 인식하고, 밝기를 늘려 읽는다 (0인 가장자리는 투명)', async () => {
    // 값 2000~8000, 왼쪽 열은 0(영상 밖)
    const f = makeTiff({ width: 8, height: 8, bands: 3, bits: 16, array: Uint16Array, fn: (c, r, b) => (c === 0 ? 0 : 2000 + c * 800 + r * 100 + b * 50) });
    expect(await probeTiff(f)).toMatchObject({ bands: 3, bits: 16, isImage: true });
    const r = await openRasterFile(f);
    expect(r.info.note).toContain('16비트 3밴드');
    expect(r.info.note).toContain('자동으로 늘려');
    const out = await r.project({ crs: 'EPSG:4326', maxDim: 8 });
    const at = (i, j) => [...out.rgba.slice((j * out.outW + i) * 4, (j * out.outW + i) * 4 + 4)];
    expect(at(0, 3)[3]).toBe(0); // 0 인 열은 투명
    const dark = at(Math.floor(out.outW * 0.3), 0);
    const bright = at(out.outW - 1, out.outH - 1);
    expect(dark[3]).toBe(255);
    expect(bright[0]).toBeGreaterThan(dark[0] + 100); // 밝기가 0~255 로 펴졌다
    r.release();
  });

  it('밴드가 4개인 16비트(RGB+근적외)도 앞 3개를 쓴다', async () => {
    const f = makeTiff({ width: 4, height: 4, bands: 4, bits: 16, array: Uint16Array, fn: (c, r, b) => 1000 + c * 500 + b * 10 });
    expect((await probeTiff(f)).isImage).toBe(true);
    const r = await openRasterFile(f);
    expect(r.info.srcWidth).toBe(4);
    r.release();
  });

  it('8비트 흑백(밴드 1개)도 이미지로 읽는다', async () => {
    const f = makeTiff({ width: 4, height: 4, bands: 1, bits: 8, array: Uint8Array, fn: (c, r) => c * 60 });
    expect((await probeTiff(f)).isImage).toBe(true);
    const r = await openRasterFile(f);
    const out = await r.project({ crs: 'EPSG:4326', maxDim: 4 });
    const px = (i) => [...out.rgba.slice(i * 4, i * 4 + 4)];
    expect(px(0)).toEqual([0, 0, 0, 255]);
    expect(px(out.outW - 1)).toEqual([180, 180, 180, 255]); // 회색: R=G=B
    r.release();
  });

  it('밴드 1개 16비트·실수는 지형 값 격자라 이미지가 아니다', async () => {
    const f16 = makeTiff({ width: 4, height: 4, bands: 1, bits: 16, array: Uint16Array, fn: (c, r) => 100 + c });
    expect((await probeTiff(f16)).isImage).toBe(false);
    const f32 = makeTiff({ width: 4, height: 4, bands: 1, bits: 32, array: Float32Array, fn: (c, r) => 100.5 + c });
    expect((await probeTiff(f32)).isImage).toBe(false);
  });
});
