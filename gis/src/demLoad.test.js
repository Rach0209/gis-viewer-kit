import { writeArrayBuffer } from 'geotiff';
import { describe, expect, it } from 'vitest';
import { createSampler, projectorFor } from './demCore.js';
import { readDemFile } from './demLoad.js';

/** 시험용 GeoTIFF (Float32 한 밴드)를 만든다 */
function makeTiff({ width, height, values, x0, y0, resX, resY, projected = null, geographic = null, nodata = null, pointRaster = false }) {
  const meta = {
    width,
    height,
    ModelPixelScale: [resX, resY, 0],
    ModelTiepoint: [0, 0, 0, x0, y0, 0],
    GTRasterTypeGeoKey: pointRaster ? 2 : 1,
    GTModelTypeGeoKey: projected ? 1 : 2,
    ...(projected ? { ProjectedCSTypeGeoKey: projected } : {}),
    ...(geographic ? { GeographicTypeGeoKey: geographic } : {}),
    ...(nodata != null ? { GDAL_NODATA: String(nodata) } : {}),
  };
  return new Blob([writeArrayBuffer(Float32Array.from(values), meta)]);
}

describe('readDemFile', () => {
  it('5186 GeoTIFF: 크기, 경계, 좌표계, 값, 범위(경위도)를 읽는다', async () => {
    const [x0, y0] = projectorFor('EPSG:5186')(127, 37.5);
    const values = Array.from({ length: 12 }, (_, i) => i * 10); // 4x3
    const blob = makeTiff({ width: 4, height: 3, values, x0, y0, resX: 5, resY: 5, projected: 5186 });
    blob.name = 'a.tif';
    const dem = await readDemFile(blob);
    expect([dem.width, dem.height]).toEqual([4, 3]);
    expect(dem.crs).toBe('EPSG:5186');
    expect(dem.bbox[0]).toBeCloseTo(x0, 6);
    expect(dem.bbox[3]).toBeCloseTo(y0, 6);
    expect(dem.bbox[2]).toBeCloseTo(x0 + 20, 6);
    expect(dem.bbox[1]).toBeCloseTo(y0 - 15, 6);
    expect(Array.from(dem.data)).toEqual(values);
    expect(dem.resolution).toEqual([5, 5]);
    expect(dem.stats).toMatchObject({ min: 0, max: 110, valid: 12, invalid: 0 });
    expect(dem.extent[0]).toBeCloseTo(127, 3);
    expect(dem.extent[3]).toBeCloseTo(37.5, 3);
    // 샘플러와 함께: 왼쪽 위 화소 중심 높이 = 0, 오른쪽 아래 화소 중심 = 110
    const s = createSampler(dem, projectorFor(dem.crs));
    expect(s.sampleXY(x0 + 2.5, y0 - 2.5)).toBeCloseTo(0, 4);
    expect(s.sampleXY(x0 + 17.5, y0 - 12.5)).toBeCloseTo(110, 4);
  });

  it('경위도(4326) GeoTIFF와 nodata', async () => {
    const values = [10, -9999, 30, 40];
    const blob = makeTiff({ width: 2, height: 2, values, x0: 127, y0: 38, resX: 0.001, resY: 0.001, geographic: 4326, nodata: -9999 });
    const dem = await readDemFile(blob);
    expect(dem.crs).toBe('EPSG:4326');
    expect(dem.nodata).toBe(-9999);
    expect(dem.stats).toMatchObject({ min: 10, max: 40, valid: 3, invalid: 1 });
    expect(dem.extent).toEqual([127, 37.998, 127.002, 38]);
  });

  it('좌표계를 모르는 코드(목록에 없는 2000)는 crs가 null이고 힌트만 준다', async () => {
    const blob = makeTiff({ width: 2, height: 2, values: [1, 2, 3, 4], x0: 200000, y0: 500000, resX: 5, resY: 5, projected: 2000 });
    const dem = await readDemFile(blob);
    expect(dem.crs).toBeNull();
    expect(dem.crsHint).toBe('EPSG:2000');
    expect(dem.extent).toBeNull();
  });

  it('화소가 점(PixelIsPoint)이면 경계가 반 화소 바깥', async () => {
    const blob = makeTiff({ width: 2, height: 2, values: [1, 2, 3, 4], x0: 100, y0: 200, resX: 10, resY: 10, projected: 5186, pointRaster: true });
    const dem = await readDemFile(blob);
    expect(dem.pixelIsPoint).toBe(true);
    expect(dem.bbox).toEqual([95, 175, 125, 205]);
  });

  it('GeoTIFF가 아니면 안내하는 오류', async () => {
    await expect(readDemFile(new Blob(['hello']))).rejects.toThrow(/GeoTIFF/);
  });
});

describe('readDemFile: 크기 상한', () => {
  it('상한을 넘으면 거절하고 안내 문장을 덧붙인다', async () => {
    const [x0, y0] = projectorFor('EPSG:5186')(127, 37.5);
    const blob = makeTiff({ width: 4, height: 3, values: Array.from({ length: 12 }, (_, i) => i), x0, y0, resX: 30, resY: 30, projected: 5186 });
    await expect(readDemFile(blob, { maxPixels: 10, hint: ' [안내]' })).rejects.toThrow(/격자가 너무 큽니다.*\[안내\]/);
    expect((await readDemFile(blob, { maxPixels: 12 })).width).toBe(4);
  });
});
