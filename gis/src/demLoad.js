/**
 * GeoTIFF 지형 파일(DEM)을 읽는다 (브라우저에서 파일을 직접, 서버 없이). 첫 번째 밴드만 쓴다.
 * 결과는 demCore.js의 createSampler / tileHeights 로 바로 쓸 수 있는 모양이다.
 */
import { fromArrayBuffer, fromBlob } from 'geotiff';
import { MAX_PIXELS, crsFromGeoKeys, heightStats, lonLatExtent } from './demCore.js';
import { isColorImage } from './rasterCore.js';

export { MAX_PIXELS };

/**
 * @param {Blob} file
 * @returns {Promise<{
 *   name:string, width:number, height:number, data:ArrayLike<number>, bbox:number[], nodata:number|null,
 *   crs:string|null, crsHint:string, pixelIsPoint:boolean, bands:number, resolution:[number, number],
 *   stats:{min:number|null, max:number|null, mean:number|null, valid:number, invalid:number},
 *   extent:number[]|null,
 * }>}
 */
export async function readDemFile(file, { maxPixels = MAX_PIXELS, hint = '' } = {}) {
  let tiff;
  try {
    // 브라우저에서는 필요한 부분만 읽는 fromBlob, FileReader가 없는 환경(Node 시험)에서는 통째로
    tiff = typeof FileReader !== 'undefined' ? await fromBlob(file) : await fromArrayBuffer(await file.arrayBuffer());
  } catch (e) {
    throw new Error(`GeoTIFF로 읽을 수 없습니다 (${e.message}). .tif/.tiff 파일인지 확인하세요.`);
  }
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bands = image.getSamplesPerPixel();
  const bits = image.getBitsPerSample?.(0) ?? 32;
  if (isColorImage({ bands, bits, format: image.getSampleFormat?.(0) ?? 1 })) throw new Error('색상 사진(밴드 3개 이상 또는 8비트 흑백)입니다. 높이 값이 든 지형(DEM) GeoTIFF를 여세요. 사진은 "이미지 열기"로 여세요.');
  if (width * height > maxPixels) {
    throw new Error(`격자가 너무 큽니다 (${width.toLocaleString('ko-KR')}×${height.toLocaleString('ko-KR')} 화소). 쓸 지역만 잘라내거나 해상도를 줄인 파일을 쓰세요.${hint}`);
  }

  let bbox;
  let res;
  try {
    bbox = image.getBoundingBox();
    res = image.getResolution();
  } catch {
    throw new Error('위치 정보(지리 참조)가 없거나 회전된 GeoTIFF입니다. 좌표가 들어 있는 정북 기준 파일이 필요합니다.');
  }
  const keys = image.getGeoKeys?.() ?? {};
  // 화소가 "점"이면 위치는 화소 중심이므로, 경계는 반 화소 바깥이다
  const pixelIsPoint = keys.GTRasterTypeGeoKey === 2;
  const resX = Math.abs(res[0]);
  const resY = Math.abs(res[1]);
  if (pixelIsPoint) bbox = [bbox[0] - resX / 2, bbox[1] - resY / 2, bbox[2] + resX / 2, bbox[3] + resY / 2];

  const rasters = await image.readRasters({ samples: [0], interleave: false });
  const data = rasters[0];
  const nodata = image.getGDALNoData?.() ?? null;
  const crs = crsFromGeoKeys(keys);
  const crsHint = keys.ProjectedCSTypeGeoKey ? `EPSG:${keys.ProjectedCSTypeGeoKey}` : keys.GeographicTypeGeoKey ? `EPSG:${keys.GeographicTypeGeoKey}` : '';
  let extent = null;
  if (crs) {
    try {
      extent = lonLatExtent(bbox, crs);
    } catch {
      extent = null;
    }
  }
  return {
    name: file.name ?? 'dem.tif',
    width,
    height,
    data,
    bbox,
    nodata,
    crs,
    crsHint,
    pixelIsPoint,
    bands,
    resolution: [resX, resY],
    stats: heightStats(data, nodata),
    extent,
  };
}
